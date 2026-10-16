import { useEffect, useRef, useState } from 'react';
import { commandStore } from '../../app/state';
import { captionStore } from '../../audio/Voice';
import { COMMAND_EXAMPLES } from '../../commands/CommandParser';
import { VoiceCommands } from '../../commands/VoiceCommands';
import { useStore } from '../../core/store';
import { useController } from '../context';

/** Typed commands (T or /), voice commands (V or the mic) and their replies. */
export function CommandBar() {
  const ctrl = useController();
  const st = useStore(commandStore, (s) => s);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showReply, setShowReply] = useState(false);

  useEffect(() => {
    if (st.open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [st.open]);

  // Replies linger for a few seconds, also after the bar closes or a voice command.
  useEffect(() => {
    if (!st.reply && !st.error) return;
    setShowReply(true);
    const id = setTimeout(() => setShowReply(false), st.error ? 6000 : 4500);
    return () => clearTimeout(id);
  }, [st.reply, st.error]);

  const run = (value: string) => {
    const v = value.trim();
    if (!v) return;
    const r = ctrl.runCommand(v);
    commandStore.set({ reply: r.reply, replyOk: r.ok, heard: '', error: '' });
    setHistory((h) => [v, ...h.filter((x) => x !== v)].slice(0, 20));
    setHIdx(-1);
    setText('');
    if (r.ok) ctrl.closeCommandBar();
  };

  const supported = VoiceCommands.supported;

  return (
    <>
      <div className="cmd-buttons">
        <button className="hud-panel pointer cmd-btn" onClick={() => ctrl.openCommandBar()} title="Type a command (T)">
          <span className="k">T</span> COMMAND
        </button>
        <button
          className={`hud-panel pointer cmd-btn ${st.listening ? 'live' : ''}`}
          onClick={() => ctrl.toggleListening()}
          title={supported ? 'Speak a command (V)' : 'Voice commands need Chrome, Edge or Safari'}
          aria-pressed={st.listening}
        >
          <span className="mic" aria-hidden>
            ●
          </span>{' '}
          {st.listening ? 'LISTENING' : 'VOICE'}
        </button>
      </div>

      {(st.listening || (showReply && !st.open && (st.reply || st.error))) && (
        <div className={`cmd-reply hud-panel ${st.error ? 'err' : st.replyOk ? 'ok' : 'warn'}`} role="status" aria-live="polite">
          {st.listening ? (
            <>
              <span className="pulse" aria-hidden /> {st.interim ? `“${st.interim}”` : 'Listening… say “Go to Victoria Terminus”'}
            </>
          ) : st.error ? (
            st.error
          ) : (
            <>
              {st.heard && <span className="heard">“{st.heard}” — </span>}
              {st.reply}
            </>
          )}
        </div>
      )}

      {st.open && (
        <div className="cmd-bar hud-panel pointer">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(text);
            }}
          >
            <span className="prompt">›</span>
            <input
              ref={inputRef}
              value={text}
              placeholder="Go to Victoria Terminus · add 5 rickshaws · drive the bus · सीएसटी चलो"
              aria-label="Command"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  ctrl.closeCommandBar();
                } else if (e.key === 'ArrowUp' && history.length) {
                  e.preventDefault();
                  const i = Math.min(history.length - 1, hIdx + 1);
                  setHIdx(i);
                  setText(history[i]);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const i = hIdx - 1;
                  setHIdx(i);
                  setText(i >= 0 ? history[i] : '');
                }
              }}
            />
            <button type="button" className={`mic-btn ${st.listening ? 'live' : ''}`} onClick={() => ctrl.toggleListening()} aria-label="Speak a command">
              ●
            </button>
            <button type="submit" className="go-btn">
              GO
            </button>
          </form>
          {(st.reply || st.error) && showReply && <div className={`cmd-inline ${st.error || !st.replyOk ? 'warn' : ''}`}>{st.error || st.reply}</div>}
          <div className="cmd-examples">
            {COMMAND_EXAMPLES.map((ex) => (
              <button key={ex.text} type="button" onClick={() => run(ex.text.split(' · ')[0])}>
                <span className="t">{ex.text}</span>
                <span className="h">{ex.hint}</span>
              </button>
            ))}
          </div>
          <div className="cmd-foot">Enter to run · Esc to close · ↑ history · {supported ? 'V or ● to speak' : 'voice needs Chrome, Edge or Safari'}</div>
        </div>
      )}
    </>
  );
}

/** Subtitles for spoken Hindi / Marathi lines, with English translations. */
export function Captions() {
  const captions = useStore(captionStore, (s) => s.captions);
  if (!captions.length) return null;
  return (
    <div className="captions" aria-live="polite">
      {captions.map((c) => (
        <div key={c.id} className="caption">
          {c.who && <span className="who">{c.who}</span>}
          <span className="deva" lang={c.lang}>
            {c.text}
          </span>
          {c.translation && <span className="tr">{c.translation}</span>}
        </div>
      ))}
    </div>
  );
}
