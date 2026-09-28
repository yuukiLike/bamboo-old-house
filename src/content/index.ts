import { zh } from './zh';
import { en } from './en';
import { ja } from './ja';
import type { Locale } from './locale';

export const content = { zh, en, ja };
export const getContent = (locale: Locale) => content[locale];
export type { Content } from './zh';
