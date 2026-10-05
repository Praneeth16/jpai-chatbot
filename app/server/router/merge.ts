import type { ConversationState } from './types';

export interface MergeResult {
  merged: string;
  is_clarification: boolean;
}

/** CONTRACTS section 6 step 1: when a clarification is pending, merged = pending_question + ' ' + message. */
export function mergeClarification(state: ConversationState, message: string): MergeResult {
  if (state.pending_clarification && state.pending_question) {
    return { merged: `${state.pending_question} ${message}`, is_clarification: true };
  }
  return { merged: message, is_clarification: false };
}
