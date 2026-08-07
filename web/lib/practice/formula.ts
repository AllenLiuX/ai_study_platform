// 安全的数学表达式求值器（无 eval / new Function）。
// 支持 + - * / ^、括号、一元负号、函数与常量。变量来自作用域对象。
// compile(expr) 返回 (scope) => number；任何解析/求值错误都返回 NaN。

type Node = (scope: Record<string, number>) => number;

interface Token {
  t: "num" | "id" | "op" | "lp" | "rp" | "comma";
  v: string | number;
}

const OPS = new Set(["+", "-", "*", "/", "^"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // 科学计数法 1e-3
      if (j < s.length && (s[j] === "e" || s[j] === "E")) {
        j++;
        if (j < s.length && (s[j] === "+" || s[j] === "-")) j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("bad number");
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (OPS.has(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp", v: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp", v: c });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ t: "comma", v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected char: ${c}`);
  }
  return tokens;
}

const FN1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

function makeFunc(name: string, args: Node[]): Node {
  const fn1 = FN1[name];
  if (fn1) return (sc) => fn1(args[0]?.(sc) ?? NaN);
  if (name === "pow") return (sc) => Math.pow(args[0]?.(sc) ?? NaN, args[1]?.(sc) ?? NaN);
  if (name === "min") return (sc) => Math.min(...args.map((a) => a(sc)));
  if (name === "max") return (sc) => Math.max(...args.map((a) => a(sc)));
  if (name === "atan2")
    return (sc) => Math.atan2(args[0]?.(sc) ?? NaN, args[1]?.(sc) ?? NaN);
  return () => NaN;
}

export function compile(expr: string): Node {
  let tokens: Token[];
  try {
    tokens = tokenize(expr);
  } catch {
    return () => NaN;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function parseExpr(): Node {
    let left = parseTerm();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const right = parseTerm();
      const l = left;
      const r = right;
      left = op === "+" ? (s) => l(s) + r(s) : (s) => l(s) - r(s);
    }
    return left;
  }

  function parseTerm(): Node {
    let left = parsePower();
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = eat().v;
      const right = parsePower();
      const l = left;
      const r = right;
      left = op === "*" ? (s) => l(s) * r(s) : (s) => l(s) / r(s);
    }
    return left;
  }

  function parsePower(): Node {
    const base = parseUnary();
    if (peek()?.t === "op" && peek().v === "^") {
      eat();
      const exp = parsePower(); // 右结合
      return (s) => Math.pow(base(s), exp(s));
    }
    return base;
  }

  function parseUnary(): Node {
    if (peek()?.t === "op" && peek().v === "-") {
      eat();
      const u = parseUnary();
      return (s) => -u(s);
    }
    if (peek()?.t === "op" && peek().v === "+") {
      eat();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const tk = peek();
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "num") {
      eat();
      const v = tk.v as number;
      return () => v;
    }
    if (tk.t === "lp") {
      eat();
      const e = parseExpr();
      if (peek()?.t !== "rp") throw new Error("missing )");
      eat();
      return e;
    }
    if (tk.t === "id") {
      eat();
      const raw = tk.v as string;
      const lower = raw.toLowerCase();
      if (peek()?.t === "lp") {
        eat();
        const args: Node[] = [];
        if (peek()?.t !== "rp") {
          args.push(parseExpr());
          while (peek()?.t === "comma") {
            eat();
            args.push(parseExpr());
          }
        }
        if (peek()?.t !== "rp") throw new Error("missing )");
        eat();
        return makeFunc(lower, args);
      }
      if (lower === "pi") return () => Math.PI;
      if (lower === "e") return () => Math.E;
      return (s) => {
        const val = s[raw] ?? s[lower];
        return typeof val === "number" ? val : NaN;
      };
    }
    throw new Error("unexpected token");
  }

  try {
    const node = parseExpr();
    if (pos !== tokens.length) return () => NaN;
    return (scope) => {
      try {
        const v = node(scope);
        return typeof v === "number" ? v : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    return () => NaN;
  }
}
