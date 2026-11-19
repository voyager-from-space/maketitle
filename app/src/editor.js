import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';

const hl = HighlightStyle.define([
  { tag: t.comment, color: '#8a8578', fontStyle: 'italic' },
  { tag: [t.keyword, t.tagName], color: '#e0a96d' },
  { tag: [t.atom, t.number], color: '#a9c7e8' },
  { tag: [t.string, t.bracket], color: '#c9d6a3' },
  { tag: t.meta, color: '#c4c0b8' },
]);
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#181714', color: '#e7e3db', fontSize: '12.5px' },
  '.cm-content': { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', caretColor: '#f7f7f4', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: '#181714', color: '#6e6a60', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#22211e' }, '.cm-activeLineGutter': { backgroundColor: '#22211e', color: '#c4c0b8' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#3a4a5c !important' },
  '.cm-cursor': { borderLeftColor: '#f7f7f4' }, '.cm-scroller': { overflow: 'auto', lineHeight: '1.5' },
}, { dark: true });

export class Editor {
  constructor(parent, { onChange, onRun }) {
    this.states = new Map(); this.path = null; this.onChange = onChange; this.onRun = onRun;
    this.view = new EditorView({ parent, state: this.makeState('') });
  }
  makeState(doc, readOnly = false) {
    return EditorState.create({ doc, extensions: [
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { this.onRun(); return true; } }])),
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), StreamLanguage.define(stex), syntaxHighlighting(hl), theme,
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      EditorView.updateListener.of((u) => { if (u.docChanged && this.path && !this.quiet) this.onChange(this.path, u.state.doc.toString()); }),
    ] });
  }
  open(path, text, readOnly = false) {
    if (this.path) this.states.set(this.path, this.view.state);
    this.path = path;
    this.quiet = true;
    this.view.setState(readOnly || !this.states.has(path) ? this.makeState(text, readOnly) : this.states.get(path));
    this.quiet = false;
  }
  reset() { this.states.clear(); this.path = null; }
  jump(line) {
    const doc = this.view.state.doc; const ln = doc.line(Math.min(Math.max(1, line), doc.lines));
    this.view.dispatch({ selection: { anchor: ln.from, head: ln.to }, scrollIntoView: true, effects: EditorView.scrollIntoView(ln.from, { y: 'center' }) });
    this.view.focus();
  }
  text() { return this.view.state.doc.toString(); }
}
