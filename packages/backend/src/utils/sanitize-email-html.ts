import sanitizeHtml from 'sanitize-html';

/**
 * Strip executable content from admin-authored email HTML before it is stored.
 *
 * ENG-233: template bodies were persisted verbatim and later rendered with
 * dangerouslySetInnerHTML, so anything that reached the column ran in the
 * viewer's session. The frontend sanitizes at its render sinks too; this is
 * the write-side half, so a request that bypasses the UI cannot seed a payload.
 *
 * The allowlist is deliberately wider than the library default because real
 * templates are table-and-inline-style email HTML. It permits layout and
 * formatting, never behaviour: <script>/<iframe>/<object> are dropped, on*
 * handlers are dropped, and href/src are restricted to safe schemes so
 * javascript: URLs cannot survive.
 */
export function sanitizeEmailHtml(html: string): string {
  // sanitize-html drops the doctype (it is not a tag). Real templates are full
  // HTML documents, and losing it puts some email clients into quirks mode, so
  // it is captured and restored. A doctype cannot carry script.
  const doctype = /^\s*<!doctype[^>]*>\s*/i.exec(html)?.[0] ?? '';

  const cleaned = sanitizeHtml(html, {
    // NOTE: 'style' is deliberately absent — sanitize-html flags a <style>
    // block as inherently XSS-vulnerable because it cannot sanitize inside it.
    // Email layout here comes from inline style="" attributes, allowed below,
    // so nothing is lost by refusing the tag.
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'center',
      'font',
      'body',
      'head',
      'html',
      'meta',
      'title',
    ],
    allowedAttributes: {
      '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'dir', 'lang'],
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'srcset'],
      table: ['border', 'cellpadding', 'cellspacing', 'role'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      font: ['color', 'face', 'size'],
      // charset and viewport only. http-equiv is withheld on purpose: it would
      // allow <meta http-equiv="refresh"> to redirect whoever opens the preview.
      meta: ['charset', 'name', 'content'],
    },
    // Inline styles are how email HTML does layout, but url() is a script
    // vector in some clients, so values are matched against explicit patterns.
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z-]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z-]+$/i],
        'text-align': [/^(left|right|center|justify)$/],
        'font-size': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-style': [/^(normal|italic|oblique)$/],
        'text-decoration': [/^[\w\s-]+$/],
        'line-height': [/^\d+(\.\d+)?(px|em|rem|pt|%)?$/],
        'letter-spacing': [/^-?\d+(\.\d+)?(px|em|rem)$/],
        margin: [/^[\d\s.a-z%-]+$/i],
        'margin-top': [/^-?\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'margin-bottom': [/^-?\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'margin-left': [/^-?\d+(\.\d+)?(px|em|rem|pt|%|auto)$/],
        'margin-right': [/^-?\d+(\.\d+)?(px|em|rem|pt|%|auto)$/],
        padding: [/^[\d\s.a-z%-]+$/i],
        'padding-top': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'padding-bottom': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'padding-left': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'padding-right': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        border: [/^[\d\s.a-z#()%,-]+$/i],
        'border-top': [/^[\d\s.a-z#()%,-]+$/i],
        'border-right': [/^[\d\s.a-z#()%,-]+$/i],
        'border-bottom': [/^[\d\s.a-z#()%,-]+$/i],
        'border-left': [/^[\d\s.a-z#()%,-]+$/i],
        'border-radius': [/^[\d\s.a-z%]+$/i],
        'border-collapse': [/^(collapse|separate)$/],
        'box-shadow': [/^(inset\s+)?[\d\s.a-z#(),%-]+$/i],
        overflow: [/^(visible|hidden|scroll|auto)$/],
        // Named filter functions only. url(), expression() and progid: are the
        // script vectors here, and none of them can match this pattern.
        filter: [
          /^((brightness|invert|grayscale|sepia|saturate|contrast|opacity|blur|hue-rotate|drop-shadow)\([^()]*\)\s*)+$/i,
        ],
        width: [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'max-width': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        'min-width': [/^\d+(\.\d+)?(px|em|rem|pt|%)$/],
        height: [/^\d+(\.\d+)?(px|em|rem|pt|%|auto)$/],
        display: [/^(block|inline|inline-block|none|table|table-cell|table-row|flex)$/],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    // {{placeholder}} tokens must survive verbatim; escaping them would break
    // variable substitution at send time.
    disallowedTagsMode: 'discard',
  });

  return doctype + cleaned;
}
