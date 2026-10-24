export function CanvasToolbar({zoom, setZoom, snapping, setSnapping, editing, setEditing, ratio, setRatio, addText, align}: {
  zoom: number; setZoom: (n: number) => void; snapping: boolean; setSnapping: (v: boolean) => void;
  editing: boolean; setEditing: (v: boolean) => void; ratio: boolean; setRatio: (v: boolean) => void;
  addText: () => void; align: (axis: 'x' | 'y') => void;
}) {
  return <div className="canvas-toolbar">
    <label><input type="checkbox" checked={editing} onChange={e => setEditing(e.target.checked)} /> Edit canvas</label>
    <label>Canvas zoom<select aria-label="Canvas zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>
      <option value={0}>Fit</option>{[.25, .5, .75, 1, 1.5, 2].map(n => <option key={n} value={n}>{n * 100}%</option>)}
    </select></label>
    <label><input type="checkbox" checked={snapping} onChange={e => setSnapping(e.target.checked)} /> Snap canvas</label>
    <label><input type="checkbox" checked={ratio} onChange={e => setRatio(e.target.checked)} /> Keep ratio</label>
    <button onClick={addText}>＋ Text</button><button onClick={() => align('x')}>Center horizontally</button>
    <button onClick={() => align('y')}>Center vertically</button>
  </div>;
}
