/* CodeMirror 5 setup for the LeetGPU editor.
 *
 * Wraps the vendored CodeMirror (see web/vendor/codemirror/README.md) with:
 *   - a CUDA mode (clike/cpp plus the CUDA keywords and builtins)
 *   - the real Vim keymap from CodeMirror's keymap/vim.js
 *   - indentation guides (CodeMirror 5 ships none, so a tiny overlay draws them)
 *
 * Exposes window.LeetGPUEditor.
 */
(function () {
  "use strict";

  const MODE_BY_LANGUAGE = {
    cuda: "text/x-cuda",
    triton: "text/x-python",
    pytorch: "text/x-python",
  };

  /* Qualifiers + warp/block intrinsics. Styling note: clike paints
     `__`-prefixed identifiers as builtins anyway (isReservedIdentifier), this
     list mainly decides keyword vs builtin tint and drives the completion
     vocabulary. Naming convention: warp/vote/shuffle intrinsics live here;
     math and runtime functions live in CUDA_BUILTINS. */
  const CUDA_KEYWORDS = [
    "__global__", "__device__", "__host__", "__shared__", "__constant__",
    "__managed__", "__restrict__", "__inline__", "__forceinline__",
    "__launch_bounds__", "__noinline__", "__grid_constant__",
    "__extern_shared__", "cooperative_groups",
    "__syncthreads", "__syncwarp", "__threadfence", "__threadfence_block",
    "__threadfence_system", "__syncthreads_count", "__syncthreads_and",
    "__syncthreads_or", "__trap", "__nanosleep",
    "__ballot", "__ballot_sync", "__any", "__any_sync", "__all", "__all_sync",
    "__activemask", "__match_any_sync", "__match_all_sync",
    "__shfl", "__shfl_sync", "__shfl_up", "__shfl_up_sync", "__shfl_down",
    "__shfl_down_sync", "__shfl_xor", "__shfl_xor_sync",
    "__reduce_add_sync", "__reduce_min_sync", "__reduce_max_sync",
    "__reduce_and_sync", "__reduce_or_sync",
    "__lanemask_lt", "__lanemask_gt", "__lanemask_le", "__lanemask_ge",
    "__popc", "__clz", "__ffs",
  ];

  const CUDA_TYPES = [
    "char2", "char3", "char4", "uchar4", "short2", "short4", "int2", "int3",
    "int4", "uint2", "uint3", "uint4", "longlong2", "float2", "float3",
    "float4", "double2", "double3", "double4", "dim3", "half", "half2",
    "__half", "__half2", "__nv_bfloat16", "__nv_bfloat162",
    "uint", "ushort", "ulong",
    "cudaError_t", "cudaStream_t", "cudaEvent_t", "cudaDeviceProp",
  ];

  const CUDA_BUILTINS = [
    "blockIdx", "blockDim", "gridDim", "threadIdx", "warpSize",
    "printf", "clock", "clock64",
    "atomicAdd", "atomicSub", "atomicMax", "atomicMin", "atomicCAS",
    "atomicExch", "atomicInc", "atomicDec", "atomicAnd", "atomicOr",
    "atomicXor",
    "cudaMalloc", "cudaMallocManaged", "cudaMallocAsync", "cudaMallocHost",
    "cudaFree", "cudaFreeAsync", "cudaFreeHost",
    "cudaMemcpy", "cudaMemcpyAsync", "cudaMemcpyToSymbol", "cudaMemset",
    "cudaMemsetAsync",
    "cudaDeviceSynchronize", "cudaGetLastError", "cudaPeekAtLastError",
    "cudaGetErrorString", "cudaGetDevice", "cudaSetDevice",
    "cudaGetDeviceCount", "cudaGetDeviceProperties",
    "cudaStreamCreate", "cudaStreamDestroy", "cudaStreamSynchronize",
    "cudaStreamWaitEvent",
    "cudaEventCreate", "cudaEventRecord", "cudaEventSynchronize",
    "cudaEventDestroy", "cudaEventElapsedTime",
    "cudaLaunchKernel", "cudaFuncSetAttribute",
    "cudaOccupancyMaxPotentialBlockSize",
    "make_float2", "make_float3", "make_float4", "make_int2", "make_int3",
    "make_int4", "make_uint2", "make_uint3", "make_uint4", "make_short2",
    "make_char2", "make_uchar2", "make_uchar4", "make_longlong2",
    "make_double2", "make_double3", "make_double4",
    "fmaf", "sqrtf", "rsqrtf", "expf", "logf", "log2f", "log10f", "exp2f",
    "powf", "fabsf", "fminf", "fmaxf", "min", "max", "abs", "fmin", "fmax",
    "_Pragma",
    "sinf", "cosf", "tanf", "tanhf", "atan2f", "atanf", "asinf", "acosf",
    "floorf", "ceilf", "truncf", "roundf", "rintf", "hypotf", "cbrtf",
    "__expf", "__logf", "__log2f", "__log10f", "__powf", "__sinf",
    "__cosf", "__fdividef", "__saturatef", "__frsqrt_rn",
    "__float2int_rn", "__float2int_rz", "__int2float_rn", "__int_as_float",
    "__float_as_int", "__float2half", "__float2half_rn", "__half2float",
    "__double_as_longlong", "__longlong_as_double",
  ];

  function words(list) {
    // CodeMirror's own `words()` builds a plain object, and mode code calls
    // `keywords.propertyIsEnumerable(...)`, so a null-prototype object breaks it.
    const map = {};
    for (const word of list) map[word] = true;
    return map;
  }

  /** Mirror of clike's own `contains`: a keyword set may be a map or a function. */
  function contains(source, word) {
    if (typeof source === "function") return source(word);
    if (!source) return false;
    return Object.prototype.propertyIsEnumerable.call(source, word);
  }

  function registerCudaMode() {
    const cpp = CodeMirror.resolveMode("text/x-c++src");
    const cudaTypes = words(CUDA_TYPES);
    CodeMirror.defineMIME("text/x-cuda", Object.assign({}, cpp, {
      keywords: Object.assign({}, cpp.keywords, words(CUDA_KEYWORDS)),
      // clike's `types` is a predicate function, so compose instead of replacing.
      types: (word) => contains(cpp.types, word) || contains(cudaTypes, word),
      builtin: words(CUDA_BUILTINS),
    }));
  }

  /* Indentation guides. The overlay tags the leading whitespace of each line;
     the CSS paints a repeating gradient at every indent stop. */
  const indentGuideOverlay = {
    token(stream) {
      if (stream.sol()) {
        const match = /^[ \t]+/.exec(stream.string);
        if (match) {
          stream.pos = match[0].length;
          return "indent-guide";
        }
      }
      stream.skipToEnd();
      return null;
    },
  };

  /* CodeMirror 5's Vim only does multi-line insert for *blockwise* visual mode.
     In real Vim, `V` (linewise) then `I`/`A` inserts into every selected line.
     We implement that directly with CodeMirror multi-selections. */
  function installLinewiseVisualInsert() {
    const Vim = window.CodeMirror.Vim;
    if (!Vim || typeof Vim.defineAction !== "function") return;

    for (const key of ["I", "A"]) {
      const actionArgs = {
        insertAt: key === "I" ? "startOfSelectedArea" : "endOfSelectedArea",
      };
      Vim.defineAction(`leetLinewise${key}`, function (cm, _args, vim) {
        if (!vim.visualMode) return;
        const selections = cm.listSelections();
        if (!selections.length) return;
        const sel = selections[0];
        const first = Math.min(sel.anchor.line, sel.head.line);
        const last = Math.max(sel.anchor.line, sel.head.line);
        const atEnd = key === "A";

        const ranges = [];
        for (let line = first; line <= last; line++) {
          const ch = atEnd ? cm.getLine(line).length : 0;
          ranges.push({
            anchor: CodeMirror.Pos(line, ch),
            head: CodeMirror.Pos(line, ch),
          });
        }

        Vim.exitVisualMode(cm, false);
        vim.insertMode = true;
        vim.insertModeRepeat = 1;
        // vim keeps `disableInput` on in normal mode; insert mode must turn it
        // back off or CodeMirror ignores every keystroke.
        cm.setOption("disableInput", false);
        cm.toggleOverwrite(false);
        // Switch the keymap first: vim's keyMap option handler resets the
        // selection, so the multi-cursor ranges must be applied last.
        cm.setOption("keyMap", "vim-insert");
        CodeMirror.signal(cm, "vim-mode-change", { mode: "insert" });
        cm.setSelections(ranges, 0, { scroll: true });
        cm.focus();
      });
      // mapCommand(keys, type, name, args, extra): `type` is the action type
      // ("action"), and the keymap context goes in `extra`.
      Vim.mapCommand(key, "action", `leetLinewise${key}`, actionArgs, {
        context: "visual",
        isEdit: true,
      });
    }
  }

  const CPP_KEYWORDS = [
    "alignas", "alignof", "auto", "bool", "break", "case", "catch", "char",
    "class", "const", "constexpr", "continue", "default", "delete", "do",
    "double", "else", "enum", "explicit", "extern", "false", "float", "for",
    "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace",
    "new", "noexcept", "nullptr", "operator", "private", "protected", "public",
    "register", "restrict", "return", "short", "signed", "sizeof", "static",
    "static_assert", "static_cast", "struct", "switch", "template", "this",
    "throw", "true", "try", "typedef", "typename", "union", "unsigned",
    "using", "virtual", "void", "volatile", "while",
  ];

  const PY_HINTS = [
    "torch", "triton", "tl", "nn", "F", "Tensor", "tensor", "dtype", "device",
    "shape", "arange", "empty_like", "zeros", "ones", "full", "float32",
    "float16", "bfloat16", "matmul", "softmax", "relu", "sigmoid", "sum", "exp",
    "sqrt", "rsqrt", "log", "abs", "maximum", "minimum", "where", "clamp",
    "load", "store", "dot", "trans", "cumsum", "argmax", "argmin", "exp2",
    "log2", "tanh", "atomic_add", "atomic_xchg", "atomic_cas", "atomic_max",
    "atomic_min", "bmm", "addmm", "einsum", "masked_fill", "no_grad",
    "stack", "cat", "chunk", "detach",
    "program_id", "num_warps", "num_stages", "constexpr",
    "autotune", "cdiv", "static_range", "range", "and", "as", "assert",
    "async", "await", "break", "class", "continue", "def", "del", "elif",
    "else", "except", "False", "finally", "for", "from", "global", "if",
    "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield", "all", "any",
    "bool", "dict", "enumerate", "int", "len", "list", "map", "max", "min",
    "print", "reversed", "round", "set", "sorted", "str", "tuple", "zip",
  ];

  /* ------------------------------------------------------------------
     Autocomplete: CUDA/C++ vocabulary, Python/Triton vocabulary, plus
     identifiers already present in the buffer.
     ------------------------------------------------------------------ */
  function vocabulary(language) {
    if (language === "cuda") {
      return [
        { words: CUDA_KEYWORDS, kind: "kw" },
        { words: CUDA_TYPES, kind: "ty" },
        { words: CUDA_BUILTINS, kind: "fn" },
        { words: CPP_KEYWORDS, kind: "kw" },
      ];
    }
    return [{ words: PY_HINTS, kind: "fn" }];
  }

  function wordBeforeCursor(cm) {
    const cursor = cm.getCursor();
    const line = cm.getLine(cursor.line).slice(0, cursor.ch);
    const match = /[A-Za-z_]\w*$/.exec(line);
    if (!match) return { from: cursor, to: cursor, typed: "" };
    return {
      from: { line: cursor.line, ch: cursor.ch - match[0].length },
      to: cursor,
      typed: match[0],
    };
  }

  function documentIdentifiers(cm) {
    const found = new Set();
    const pattern = /[A-Za-z_]\w{2,}/g;
    const text = cm.getValue();
    let match;
    while ((match = pattern.exec(text)) !== null) {
      found.add(match[0]);
      if (found.size > 800) break;
    }
    return found;
  }

  /* Preprocessor completions. The identifier vocabulary has nothing useful
     for hash lines, so a `#` directive gets its own staged list instead:
     what may follow `#` directly, what may follow `#pragma `, and which
     headers may follow `#include ` (drawn from what the challenge solutions
     actually include). */
  const CUDA_HASH_DIRECTIVES = [
    "define", "elif", "else", "endif", "error", "if", "ifdef", "ifndef",
    "include", "line", "pragma", "undef", "warning",
  ];
  const CUDA_PRAGMA_ARGS = ["unroll", "nounroll", "once"];
  const CUDA_INCLUDES = [
    "cuda_runtime.h", "cuda_fp16.h", "cuda_bf16.h", "math_constants.h",
    "math.h", "stdio.h", "assert.h",
    "cmath", "cstddef", "cstdint", "cfloat", "climits", "cstring",
  ];

  /* Completion context of the text before the cursor on a preprocessor line,
     or null when the cursor is not in a `#`-directive. `typed` is what the
     insertion will replace, `typedWord` what the candidates match against. */
  function hashContext(linePrefix) {
    let match = /^\s*#\s*pragma\s+(\S*)$/.exec(linePrefix);
    if (match) return { typed: match[1], words: CUDA_PRAGMA_ARGS };
    match = /^\s*#\s*include\s+(<?)([\w./+-]*)$/.exec(linePrefix);
    if (match) {
      return { typed: match[1] + match[2], typedWord: match[2], words: CUDA_INCLUDES, bracket: true };
    }
    match = /^\s*#\s*(\S*)$/.exec(linePrefix);
    return match ? { typed: match[1], words: CUDA_HASH_DIRECTIVES } : null;
  }

  function buildHints(cm, language) {
    const cursor = cm.getCursor();
    // In a hash directive the usual word matching is bypassed: `#pragma un`
    // has to reach "unroll" and `#include <cud` has to reach
    // "<cuda_runtime.h>" — neither lives in an identifier list. Once the
    // candidates are exhausted there is no popup rather than an unrelated one.
    if (language === "cuda") {
      const directive = hashContext(cm.getLine(cursor.line).slice(0, cursor.ch));
      if (directive) {
        const list = directive.words
          .filter((word) => word.startsWith(directive.typedWord ?? directive.typed))
          .map((word) => {
            const text = directive.bracket ? `<${word}>` : word;
            return { text, displayText: text, className: "leet-hint-kw" };
          });
        return list.length
          ? { list, from: { line: cursor.line, ch: cursor.ch - directive.typed.length }, to: cursor }
          : null;
      }
    }
    const { from, to, typed } = wordBeforeCursor(cm);
    const lower = typed.toLowerCase();
    const seen = new Set();
    const list = [];

    const add = (text, kind, matchLower) => {
      if (!text || seen.has(text)) return;
      const matches = matchLower ? text.toLowerCase().startsWith(lower) : text.startsWith(typed);
      if (!matches) return;
      seen.add(text);
      list.push({
        text,
        displayText: text,
        className: `leet-hint-${kind}`,
      });
    };

    for (const group of vocabulary(language)) {
      for (const word of group.words) add(word, group.kind, false);
    }
    // Identifiers from the current solution are matched case-insensitively.
    if (typed.length >= 2) {
      for (const word of documentIdentifiers(cm)) add(word, "doc", true);
    }
    // 300 covers the whole built-in CUDA vocabulary (~270 words); nothing is
    // cut even when Ctrl-Space is pressed next to an empty prefix.
    return { list: list.slice(0, 300), from, to };
  }

  function installCompletion(editor) {
    const run = (cm, manual) => {
      if (cm.state.completionActive) return;
      const language = editor.getOption("mode") === "text/x-cuda" ? "cuda" : "python";
      // Hash directives stay active after a single typed char (`#pragma u`
      // must reach "unroll"); ordinary identifiers keep the two-char gate.
      const cursor = cm.getCursor();
      const inDirective =
        language === "cuda" && hashContext(cm.getLine(cursor.line).slice(0, cursor.ch));
      if (!manual && !inDirective && wordBeforeCursor(cm).typed.length < 2) return;
      cm.showHint({
        hint: (instance, options) => buildHints(instance, options.language),
        language,
        completeSingle: false,
      });
    };

    editor.setOption("extraKeys", Object.assign({}, editor.getOption("extraKeys"), {
      "Ctrl-Space": (cm) => run(cm, true),
      "Cmd-Space": (cm) => run(cm, true),
    }));

    editor.on("inputRead", (cm, change) => {
      if (change.origin !== "+input") return;
      const inserted = change.text.join("");
      if (!/[A-Za-z_]/.test(inserted)) return;
      run(cm, false);
    });
  }

  /* Vim's <C-a> increments the number under the cursor, which shadows the
     browser's Select All. That one is worth reclaiming (incrementing is rarely
     used here). <C-x>/<C-v> are left alone: they are genuine Vim commands
     (decrement-number, blockwise visual) and vim.js cannot unmap its own
     defaults, so overriding them would just break Vim instead of helping. */
  function installSelectAllShortcut() {
    const Vim = window.CodeMirror.Vim;
    if (!Vim || typeof Vim.defineAction !== "function") return;

    Vim.defineAction("leetSelectAll", (cm) => cm.execCommand("selectAll"));
    for (const context of ["normal", "visual"]) {
      // mapCommand unshifts, so this wins over the built-in default.
      Vim.mapCommand("<C-a>", "action", "leetSelectAll", {}, { context });
    }
  }

  /* Vim's yank/delete only fill internal registers. Real Vim users add
     `set clipboard=unnamed` (or use "+y). We provide both: "+ / "* are backed by
     the OS clipboard, and the unnamed register mirrors into it so a plain `y`
     lands in the clipboard. No key binding is changed. */
  function clipboardWrite(text) {
    if (!text) return;
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {
      /* clipboard blocked (no permission / insecure context) */
    }
  }

  function createClipboardRegister() {
    return {
      keyBuffer: [""],
      linewise: false,
      blockwise: false,
      setText(text, linewise, blockwise) {
        this.keyBuffer = [text || ""];
        this.linewise = !!linewise;
        this.blockwise = !!blockwise;
        clipboardWrite(text);
      },
      pushText(text, linewise) {
        if (linewise) {
          if (!this.linewise) this.keyBuffer.push("\n");
          this.linewise = true;
        }
        this.keyBuffer.push(text);
        clipboardWrite(this.toString());
      },
      pushInsertModeChanges() {},
      pushSearchQuery() {},
      clear() {
        this.keyBuffer = [];
        this.linewise = false;
        this.blockwise = false;
      },
      toString() {
        return this.keyBuffer.join("");
      },
    };
  }

  function installClipboardRegisters(editor) {
    const Vim = window.CodeMirror.Vim;
    if (!Vim || typeof Vim.defineRegister !== "function") return;

    const register = createClipboardRegister();

    // vim.js rebuilds its register controller whenever it (re)enters vim mode,
    // so this must be idempotent and re-applied on every mode change.
    const ensure = () => {
      const controller = Vim.getRegisterController?.();
      const registers = controller?.registers;
      if (!registers) return;
      for (const name of ["+", "*"]) {
        if (registers[name]) continue;
        try {
          Vim.defineRegister(name, register);
        } catch {
          /* another script defined it first */
        }
      }
      // Patch the prototype, not the instance: the instance is replaced on
      // every reset, the prototype object is stable.
      const proto = Object.getPrototypeOf(controller);
      if (proto && !proto.leetClipboardPatched) {
        const original = proto.pushText;
        proto.pushText = function (name, operator, text, linewise, blockwise) {
          original.call(this, name, operator, text, linewise, blockwise);
          // vim.js passes null (or '"') for the unnamed register that plain y/d
          // write to, so mirror those yanks/deletes into the OS clipboard.
          if ((name === null || name === undefined || name === "" || name === '"') && text) {
            clipboardWrite(text);
          }
        };
        proto.leetClipboardPatched = true;
      }
    };

    ensure();
    editor.on("vim-mode-change", ensure);

    // Refresh the register cache when the user pastes from outside.
    editor.getWrapperElement().addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text) register.setText(text, /\n$/.test(text), false);
    });
  }

  function modeFor(language) {
    return MODE_BY_LANGUAGE[language] || MODE_BY_LANGUAGE.cuda;
  }

  /**
   * Build the editor over an existing <textarea>.
   * Returns { editor, setVim, setLanguage, onVimModeChange, onSaveRequest }.
   */
  function create(textarea, options) {
    registerCudaMode();
    installLinewiseVisualInsert();
    const settings = options || {};

    const editor = CodeMirror.fromTextArea(textarea, {
      value: settings.value || "",
      mode: modeFor(settings.language),
      theme: "leetgpu",
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      smartIndent: true,
      electricChars: true,
      lineWrapping: false,
      viewportMargin: Infinity,
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      showCursorWhenSelecting: true,
      keyMap: settings.vim === false ? "default" : "vim",
    });

    editor.addOverlay(indentGuideOverlay);
    installClipboardRegisters(editor);
    installSelectAllShortcut();
    installCompletion(editor);

    // Let Vim's `:w` / `:wq` persist the draft instead of doing nothing.
    if (window.CodeMirror.Vim && typeof window.CodeMirror.Vim.defineEx === "function") {
      window.CodeMirror.Vim.defineEx("write", "w", () => {
        if (typeof settings.onSave === "function") settings.onSave();
        editor.setOption("keyMap", editor.getOption("keyMap"));
      });
      window.CodeMirror.Vim.defineEx("wq", "wq", () => {
        if (typeof settings.onSave === "function") settings.onSave();
      });
    }

    const modeHandlers = [];
    editor.on("vim-mode-change", (event) => {
      for (const handler of modeHandlers) handler(event.mode, event.subMode);
    });

    return {
      editor,
      setLanguage(language) {
        editor.setOption("mode", modeFor(language));
      },
      setVim(enabled) {
        // Leave insert mode *before* the vim keymap is detached: once the
        // keymap changes, vim.js has torn down `editor.state.vim` and
        // exitInsertMode would throw on the null state.
        if (!enabled && window.CodeMirror.Vim) {
          try {
            window.CodeMirror.Vim.exitInsertMode(editor);
          } catch {
            /* vim state already gone — nothing to exit */
          }
        }
        editor.setOption("keyMap", enabled ? "vim" : "default");
        editor.focus();
      },
      onVimModeChange(handler) {
        modeHandlers.push(handler);
      },
      refresh() {
        editor.refresh();
      },
    };
  }

  window.LeetGPUEditor = { create, modeFor };
})();
