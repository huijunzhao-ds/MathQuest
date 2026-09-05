// mathviz.js builds real DOM nodes. In Node we give it just enough of one that
// the geometry and captions can be checked without a browser.
class El {
  constructor() { this.children = []; this.style = {}; this.className = ''; this.textContent = ''; }
  appendChild(c) { this.children.push(c); return c; }
}
globalThis.matchMedia = () => ({ matches: false });
globalThis.document = { createElement: () => new El() };
