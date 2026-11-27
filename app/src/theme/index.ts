import { useColorScheme } from 'react-native';

/** Brandbook 01 palette. Mint only on dark surfaces, shapes and active states. */
export const brand = {
  pine: '#073E2B',
  mint: '#78FF9B',
  ink: '#152019',
  paper: '#F7F9F5',
  mist: '#E8EFE8',
  gray: '#6F7B72',
};

export type Theme = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  line: string;
  danger: string;
  /** Dims the screen behind the side panel. */
  scrim: string;
  /** Spending went up / down; also the first part of the "more often or pricier" bar. */
  more: string;
  less: string;
  /** Second part of that bar: each purchase costing more. */
  price: string;
  /** Calendar steps from little to most spending, and text on the last one. */
  heat1: string;
  heat2: string;
  heat3: string;
  heat4: string;
  onHeat: string;
  /** Pine card that opens a screen, in both themes; mint for the highlight. */
  heroBg: string;
  heroText: string;
  heroMuted: string;
  heroHi: string;
  /** The user's chat bubble and its text. */
  userBubble: string;
  onUserBubble: string;
  /** Tool cards in the chat, and the background of a failed one or an error reply. */
  toolBg: string;
  dangerBg: string;
};

const light: Theme = {
  bg: brand.paper,
  surface: brand.mist,
  text: brand.ink,
  // Darker than brand.gray: #6F7B72 on mist is ~3.8:1, below 4.5:1 for small text.
  muted: '#57635B',
  accent: brand.pine,
  onAccent: '#FFFFFF',
  line: '#D5DED6',
  danger: '#9A2A1F',
  scrim: 'rgba(7, 20, 14, 0.45)',
  more: '#B3472B',
  less: '#0B6B45',
  price: '#9A6A00',
  heat1: '#F3DED6',
  heat2: '#E6B3A3',
  heat3: '#CF7A5E',
  heat4: '#B3472B',
  onHeat: '#FFFFFF',
  heroBg: brand.pine,
  heroText: brand.paper,
  heroMuted: '#A9C7B6',
  heroHi: brand.mint,
  userBubble: brand.pine,
  onUserBubble: brand.paper,
  toolBg: '#EFF3ED',
  dangerBg: '#FBE6E2',
};

const dark: Theme = {
  bg: '#0B1410',
  surface: '#16231C',
  text: '#E8EFE8',
  muted: '#9AA79E',
  accent: brand.mint,
  onAccent: brand.ink,
  line: '#24352B',
  danger: '#FF8A7A',
  scrim: 'rgba(7, 20, 14, 0.45)',
  more: '#FF8F73',
  less: brand.mint,
  price: '#F2C94C',
  heat1: '#33241F',
  heat2: '#5E3326',
  heat3: '#9E4B34',
  heat4: '#FF8F73',
  onHeat: brand.ink,
  heroBg: brand.pine,
  heroText: brand.paper,
  heroMuted: '#A9C7B6',
  heroHi: brand.mint,
  userBubble: '#1E4931',
  onUserBubble: '#F0F8F0',
  toolBg: '#132019',
  dangerBg: '#3D1A17',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
