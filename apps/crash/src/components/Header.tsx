import { useEffect, useRef, useState } from 'react';
import { playClick } from '../audio/sound.js';
import { useAppStore } from '../state/store.js';
import './Header.css';

/**
 * The top bar: the game's name, and the player behind a profile button.
 *
 * The dropdown holds the presentation switches — sound and music — because
 * they are settings a player changes once and forgets, and putting them on
 * the bar itself would compete with the rocket for attention every round.
 *
 * The switches read and write the store rather than holding their own
 * state, because the sound engine subscribes to the same slice. Keeping the
 * truth in one place is what stops the control and the audio disagreeing
 * after a remount.
 */

/** Placeholder until a session tells us who is playing. */
const PLAYER_NAME = 'Oleg Bobokhidze';

/** One labelled On/Off switch. */
function SettingRow({
  label,
  on,
  onChange,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onChange: () => void;
}) {
  return (
    <div className="profile-setting">
      <span className="profile-setting__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`profile-switch${on ? ' profile-switch--on' : ''}`}
        onClick={onChange}
      >
        <span className="profile-switch__track">
          <span className="profile-switch__knob" />
        </span>
        <span className="profile-switch__text">{on ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const soundEnabled = useAppStore((state) => state.soundEnabled);
  const musicEnabled = useAppStore((state) => state.musicEnabled);
  const setSoundEnabled = useAppStore((state) => state.setSoundEnabled);
  const setMusicEnabled = useAppStore((state) => state.setMusicEnabled);
  const wrapRef = useRef<HTMLDivElement>(null);

  // A dropdown that only closes on its own button is a trap on touch, so
  // any click outside it and Escape both dismiss it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = PLAYER_NAME.split(' ')
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="header app-card">
      <span className="header__brand">
        Orbit<strong>Crash</strong>
      </span>

      <div className="header__profile" ref={wrapRef}>
        <button
          type="button"
          className={`profile-button${open ? ' profile-button--open' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => {
            playClick();
            setOpen((value) => !value);
          }}
        >
          <span className="profile-button__avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="profile-button__caret" aria-hidden="true">
            ▾
          </span>
          <span className="profile-button__sr">Profile and settings</span>
        </button>

        {open && (
          <div className="profile-menu" role="menu">
            <div className="profile-menu__head">
              <span className="profile-menu__avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="profile-menu__name">{PLAYER_NAME}</span>
            </div>

            <div className="profile-menu__body">
              <SettingRow
                label="Sound"
                on={soundEnabled}
                onChange={() => {
                  // Click first, then flip: turning sound off should still
                  // acknowledge the press that did it.
                  playClick();
                  setSoundEnabled(!soundEnabled);
                }}
              />
              <SettingRow
                label="Music"
                on={musicEnabled}
                onChange={() => {
                  playClick();
                  setMusicEnabled(!musicEnabled);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
