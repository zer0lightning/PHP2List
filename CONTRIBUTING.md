# Contributing to PHP2List

Thanks for helping. A few things to know first.

## Where your change belongs

- **Corrections or new entries in the software list** (a product, status, version or note):
  these belong to the source list, not here. Follow NCSC-NL's
  [contribution guidelines](https://github.com/NCSC-NL/php2shell#contributions-welcome).
  PHP2List picks up accepted changes automatically.
- **Security issues in PHP2List**: please report privately; see [SECURITY.md](SECURITY.md).
- **Bugs or improvements to this website**: issues and pull requests are welcome here. This is a
  volunteer project without a support commitment, so replies are best-effort.

## Making a change

```bash
npm ci
npm run dev            # http://127.0.0.1:8788
npm test               # must pass
npm run test:browser   # needs `npm run dev` running and Playwright installed (see README)
```

- `public/disclaimer.html`, `privacy.html`, `about.html`, `what-is-php2shell.html`,
  `acknowledgements.html`, `charts.html` and `404.html` are **generated**. Edit
  `tools/build_pages.py` (or the header and footer in `public/index.html`), then run
  `npm run build:pages` and commit the result. CI fails if they're out of date.
- Keep the security model intact (see [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)):
  - no inline scripts, inline styles or inline event handlers (the CSP forbids them);
  - no third-party resources;
  - escape all data before inserting HTML, or use `textContent`;
  - keep `public/_headers` and the Worker's CSP identical.
- Factual text about the vulnerabilities must come from the official sources listed on the
  "What is PHP2Shell" page, and be checked against them.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
