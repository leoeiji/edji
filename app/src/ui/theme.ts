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
};

const light: Theme = {
  bg: brand.paper,
  surface: brand.mist,
  text: brand.ink,
  muted: brand.gray,
  accent: brand.pine,
  onAccent: '#FFFFFF',
  line: '#D5DED6',
  danger: '#9A2A1F',
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
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
