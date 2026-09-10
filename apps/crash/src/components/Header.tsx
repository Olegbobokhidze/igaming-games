import { useEffect, useRef, useState } from 'react';
import './Header.css';

/**
 * The top bar: the game's name, and the player behind a profile button.
 *
 * The dropdown holds the three presentation switches — sound, music and
 * animation — because they are settings a player changes once and forgets,
 * and putting them on the bar itself would compete with the rocket for
 * attention every round.
 *
 * The switches are chrome only at this stage: they hold their own state so
 * the control reads correctly, but nothing is wired to the audio or the
 * scene yet.
 */

/** Placeholder until a session tells us who is playing. */
const PLAYER_NAME = 'Oleg Bobokhidze';

interface Toggle {
  readonly id: 'sound' | 'music' | 'animation';
  readonly label: string;
}

const TOGGLES: readonly Toggle[] = [
  { id: 'sound', label: 'Sound' },
  { id: 'music', label: 'Music' },
  { id: 'animation', label: 'Animation' },
];

type ToggleState = Record<Toggle['id'], boolean>;

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
  const [settings, setSettings] = useState<ToggleState>({
    sound: true,
    music: true,
    animation: true,
  });
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
    <header className="header">
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
              {TOGGLES.map((toggle) => (
                <SettingRow
                  key={toggle.id}
                  label={toggle.label}
                  on={settings[toggle.id]}
                  onChange={() => {
                    setSettings((current) => ({
                      ...current,
                      [toggle.id]: !current[toggle.id],
                    }));
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
