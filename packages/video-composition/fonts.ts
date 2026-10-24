import {useEffect, useMemo, useState} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';
import type {FontAsset} from '../project-model/text';
import {fontFamily} from '../project-model/text';

const loaded = new Map<string, FontFace>();
export function useProjectFonts(fonts: FontAsset[], urls: Record<string, string>) {
  const signature = JSON.stringify(fonts.map(font => [font.id, font.hash, urls[font.file]]));
  const handle = useMemo(() => delayRender('Load imported project fonts'), [signature]);
  const [failure, setFailure] = useState<{signature: string; error: Error} | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all(fonts.map(async font => {
      const url = urls[font.file]; if (!url) throw new Error(`Missing font ${font.name}. Repair the original font file.`);
      const family = fontFamily(`font:${font.id}`), key = `${family}:${font.hash}:${url}`;
      if (!loaded.has(key)) {
        const face = await new FontFace(family, `url(${JSON.stringify(url)})`).load();
        document.fonts.add(face); loaded.set(key, face);
      }
    })).then(() => {if (active) continueRender(handle);}).catch(error => {
      if (!active) return;
      const failure = new Error(`Imported font failed to load. Repair its identical original. ${error.message}`);
      setFailure({signature, error: failure}); cancelRender(failure);
    });
    return () => {active = false; continueRender(handle);};
  }, [signature, handle]);
  if (failure?.signature === signature) throw failure.error;
}
