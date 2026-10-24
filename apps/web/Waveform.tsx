import {useEffect, useRef, useState} from 'react';
import WaveSurfer from 'wavesurfer.js';

export function Waveform({src, time, seek, range}: {src: string; time: number; seek: (ms: number) => void;
  range?: {startMs: number; endMs: number; sourceDurationMs: number}}) {
  const container = useRef<HTMLDivElement>(null), wave = useRef<WaveSurfer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    const instance = WaveSurfer.create({container: container.current!, url: src, height: 46,
      waveColor: '#bac4d8', progressColor: '#6654c7', cursorWidth: 0, normalize: true, interact: false});
    wave.current = instance;
    instance.on('error', () => setError('Waveform unavailable; playback still works.'));
    return () => {wave.current = null; instance.destroy();};
  }, [src]);
  useEffect(() => {if (wave.current?.getDuration()) wave.current.setTime(time / 1000);}, [time]);
  return <div className="waveform" onClick={e => {const rect = e.currentTarget.getBoundingClientRect();
    const duration = wave.current?.getDuration(); if (duration) seek(range ? range.startMs + (e.clientX - rect.left) / rect.width * (range.endMs - range.startMs) : (e.clientX - rect.left) / rect.width * duration * 1000);}}>
    <div ref={container} style={range ? {width: `${range.sourceDurationMs / (range.endMs - range.startMs) * 100}%`,
      marginLeft: `${-range.startMs / (range.endMs - range.startMs) * 100}%`} : undefined} />{error && <small>{error}</small>}
  </div>;
}

