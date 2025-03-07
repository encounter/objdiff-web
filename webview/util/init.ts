if (window.webviewProps?.resourceRoot) {
  __webpack_public_path__ = window.webviewProps.resourceRoot;
}
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme) {
  document.body.classList.add(theme);
}
