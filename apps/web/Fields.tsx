export function NumberField({label, value, change, step = .1, min, max}: {
  label: string; value: number; change: (value: number) => void; step?: number; min?: number; max?: number;
}) {
  return <label className="number-field">{label}<input key={value} aria-label={label} type="number"
    defaultValue={Number(value.toFixed(3))} step={step} min={min} max={max}
    onKeyDown={e => {if (e.key === 'Enter') e.currentTarget.blur();}}
    onBlur={e => {const n = Number(e.currentTarget.value); if (e.currentTarget.value && Number.isFinite(n) && n !== Number(value.toFixed(3))) change(n); e.currentTarget.value = String(Number(value.toFixed(3)));}} /></label>;
}

