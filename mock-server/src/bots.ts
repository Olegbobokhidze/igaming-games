/**
 * Synthetic players.
 *
 * A crash game is a shared table: an empty bet list makes the whole thing
 * feel abandoned, and there is nothing to build a leaderboard or a round
 * history from. Rather than hand the client a hardcoded list, these bots
 * join the real round engine and place real bets through the same code
 * path a human uses.
 *
 * The point is that nothing downstream knows the difference. The engine
 * settles them exactly as it settles a person, the history accumulates on
 * its own, and when a real backend replaces this file the client needs no
 * change at all.
 */

import { fromMultiplier, type RoundEngine } from '@igaming/core';

/**
 * Display names. Deliberately test-looking rather than plausible real
 * people — nobody should mistake a bot for another player's account.
 */
const NAMES = [
  'Nika_G',
  'Data_99',
  'Luka_T',
  'Ana_K',
  'Zura_M',
  'Mari_B',
  'Giorgi_P',
  'Tamar_L',
  'Sandro',
  'Nino_V',
  'Beka_77',
  'Salome',
  'Irakli_D',
  'Keti_R',
  'Vano',
  'Lasha_X',
  'Elene',
  'Dato_21',
  'Tako_S',
  'Gio_Q',
  'Mariam',
  'Levan_B',
  'Nutsa',
  'Rezo_4',
  'Khatuna',
  'Guga',
  'Natia',
  'Beso_88',
  'Tornike',
  'Kakha',
  'Lika_3',
  'Gvantsa',
  'Shorena',
  'Giorgi_K',
  'Nino_2',
  'Keti_5',
  'Beka_1',
  'Tamar_7',
  'Luka_8',
  'Ana_9',
  'Zura_10',
  'Mari_11',
  'Giorgi_12',
  'Tamar_13',
  'Sandro_14',
  'Nino_15',
  'Beka_16',
  'Salome_17',
  'Irakli_18',
  'Keti_19',
  'Vano_20',
  'Lasha_21',
  'Elene_22',
  'Dato_23',
  'Tako_24',
  'Gio_25',
  'Mariam_26',
  'Levan_27',
  'Nutsa_28',
  'Rezo_29',
  'Khatuna_30',
  'Guga_31',
  'Natia_32',
  'Beso_33',
  'Tornike_34',
  'Kakha_35',
  'Lika_36',
  'Gvantsa_37',
  'Shorena_38',
  'Giorgi_K2',
  'Nino_39',
  'Keti_40',
  'Beka_41',
  'Tamar_42',
  'Luka_43',
  'Ana_44',
  'Zura_45',
  'Mari_46',
  'Giorgi_47',
  'Tamar_48',
  'Sandro_49',
  'Nino_50',
  'Beka_51',
  'Salome_52',
  'Irakli_53',
  'Keti_54',
  'Vano_55',
  'Lasha_56',
  'Elene_57',
  'Dato_58',
  'Tako_59',
  'Gio_60',
  'Mariam_61',
  'Levan_62',
] as const;

/** Stakes bots choose from, in minor units. Weighted toward the small end. */
const STAKES = [100, 100, 200, 500, 500, 1000, 1000, 2000, 5000, 10_000];

export interface Bot {
  readonly id: string;
  readonly name: string;
}

const random = (min: number, max: number): number => min + Math.random() * (max - min);

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)] as T;

/**
 * Draw an auto-cashout target.
 *
 * Most players are cautious and take a small multiple; a few chase the
 * tail. Skewing the distribution this way is what makes the bet list read
 * as a crowd rather than a uniform sample — the interesting moments are
 * when the careful majority has already cashed out and one holdout is
 * still in.
 */
function drawTarget(): number {
  const roll = Math.random();
  if (roll < 0.55) return random(1.1, 2);
  if (roll < 0.85) return random(2, 4);
  if (roll < 0.97) return random(4, 12);
  return random(12, 60);
}

export interface BotPool {
  /** Names by player id, for rendering the bet list. */
  readonly nameOf: (playerId: string) => string | undefined;
  /** Every bot currently seated. */
  readonly all: () => readonly Bot[];
  /** Called when a round opens: some bots bet, some sit it out. */
  readonly placeBets: (now: number) => void;
}

export function createBotPool(engine: RoundEngine, count = 25): BotPool {
  const bots: Bot[] = [];
  const names = new Map<string, string>();

  // Shuffle so a restart does not always seat the same first N names.
  const shuffled = [...NAMES].sort(() => Math.random() - 0.5);

  for (let i = 0; i < Math.min(count, shuffled.length); i += 1) {
    const name = shuffled[i];
    if (name === undefined) continue;
    const id = `bot:${String(i)}`;
    engine.join(id);
    bots.push({ id, name });
    names.set(id, name);
  }

  return {
    nameOf: (playerId) => names.get(playerId),
    all: () => bots,
    placeBets: (now) => {
      for (const bot of bots) {
        // Not everyone plays every round; a table where all 14 bet every
        // time looks mechanical.
        if (Math.random() > 0.72) continue;

        // Most bots set an auto-cashout, a few play it by hand and are
        // simply never cashed out — which is what produces losses.
        const target = Math.random() < 0.82 ? fromMultiplier(drawTarget()) : null;
        engine.placeBet(bot.id, pick(STAKES), target, now);
      }
    },
  };
}
