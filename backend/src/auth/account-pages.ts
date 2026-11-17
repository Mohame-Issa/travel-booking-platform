/**
 * ACC-02 / ACC-07 (bonus): tiny server-rendered pages, so the links in the
 * emails work by just clicking them (Milestone 1 has no frontend yet).
 * No JavaScript, no external files; every value is HTML-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A whole page. `body` must already be safe HTML. */
export function accountPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} - Travel Platform</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f6f8; color: #1d2733; margin: 0; padding: 16px; }
  main { max-width: 420px; margin: 48px auto; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h1 { font-size: 1.4rem; margin: 0 0 12px; }
  p { line-height: 1.5; }
  .ok { color: #16794c; } .err { color: #b42318; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #c5ced8; border-radius: 8px; font-size: 1rem; }
  button { margin-top: 18px; width: 100%; padding: 11px; border: 0; border-radius: 8px; background: #1f6feb; color: #fff; font-size: 1rem; cursor: pointer; }
  ul { padding-left: 20px; } small { color: #5b6776; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** Simple result page (success or error). */
export function messagePage(
  title: string,
  message: string,
  ok: boolean,
): string {
  return accountPage(
    title,
    `<h1 class="${ok ? 'ok' : 'err'}">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
  );
}
