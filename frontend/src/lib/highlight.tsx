const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'class',
  'async',
  'await',
  'new',
  'return',
  'type',
  'default',
  'true',
  'false',
  'undefined',
]);

type Token = { kind: 'plain' | 'keyword' | 'string' | 'comment'; text: string };

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const commentAt = line.indexOf('//');
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : '';
  const pattern = /('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`)|([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z_'"`]+)/g;
  let match: RegExpExecArray | null;
  let cursor = 0;

  while ((match = pattern.exec(code))) {
    if (match.index > cursor) tokens.push({ kind: 'plain', text: code.slice(cursor, match.index) });
    if (match[1]) tokens.push({ kind: 'string', text: match[1] });
    else if (match[2]) tokens.push({ kind: KEYWORDS.has(match[2]) ? 'keyword' : 'plain', text: match[2] });
    else tokens.push({ kind: 'plain', text: match[3] });
    cursor = match.index + match[0].length;
  }
  if (cursor < code.length) tokens.push({ kind: 'plain', text: code.slice(cursor) });
  if (comment) tokens.push({ kind: 'comment', text: comment });
  return tokens;
}

export function HighlightedCode({ code }: { code: string }) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <pre className="code-block" aria-label="Generated TypeScript">
      <code>
        {lines.map((line, index) => (
          <span className="code-line" key={`${index}-${line.slice(0, 12)}`}>
            <span className="line-no">{index + 1}</span>
            <span>
              {tokenizeLine(line).map((token, tokenIndex) => (
                <span className={token.kind === 'plain' ? undefined : `tok-${token.kind}`} key={tokenIndex}>
                  {token.text}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
