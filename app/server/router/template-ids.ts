import type { RouteId } from '../../shared/api';

/** One template per route (lang is the second key part). 4.1 and 4.2 share a header; 5.1 has its own. */
export const TEMPLATE_BY_ROUTE: Record<RouteId, string> = {
  '0a': 'T_0A',
  '0b': 'T_0B',
  '0c_greeting': 'T_0C_GREETING',
  '0c_closing': 'T_0C_CLOSING',
  '0c_about': 'T_0C_ABOUT',
  '1': 'T_1',
  '2': 'T_2',
  '3.1': 'T_3_1',
  '3.2': 'T_3_2',
  '4.1': 'T_4X_HEADER',
  '4.2': 'T_4X_HEADER',
  '5.1': 'T_5_1_HEADER',
  '5.2': 'T_5_2',
  '6.1': 'T_6_1',
  '6.2': 'T_6_2',
  '7.1': 'T_7_1',
  '8.1': 'T_8_1',
  '8.2': 'T_8_2',
};
