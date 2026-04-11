/**
 * Permission checker — evaluates permission rules and delegates to handlers.
 * Enhanced with rule engine integration and denial tracking.
 */

import { AgentError } from '../core/errors.js';
import {
  type DenialLimits,
  type DenialTrackingState,
  evaluateRules,
  recordAllow,
  recordDenial,
} from './rules.js';
import type {
  PermissionContext,
  PermissionDecision,
  PermissionHandler,
  PermissionMode,
  PermissionRule,
} from './types.js';
import { allowAllHandler, defaultHandler, readOnlyHandler, strictDenyAllHandler } from './types.js';

/**
 * Get the appropriate permission handler for the given mode.
 */
export function getHandlerForMode(
  mode: PermissionMode,
  customHandler?: PermissionHandler
): PermissionHandler {
  switch (mode) {
    case 'allowAll':
      return allowAllHandler;
    case 'denyAll':
      return strictDenyAllHandler;
    case 'readOnly':
      return readOnlyHandler;
    case 'custom':
      if (!customHandler) {
        throw new AgentError(
          'Custom permission mode requires a permissionHandler',
          'INVALID_CONFIG'
        );
      }
      return customHandler;
    default:
      return customHandler ?? defaultHandler;
  }
}

/**
 * Extended options for permission checking with rule engine support.
 */
export interface CheckToolPermissionOptions {
  /** Static permission rules to evaluate before the handler */
  rules?: PermissionRule[];
  /** Denial tracking state (mutated in-place) */
  denialTracking?: DenialTrackingState;
  /** Denial limits configuration */
  denialLimits?: DenialLimits;
}

/**
 * Check permission for a tool execution.
 *
 * Evaluation order:
 * 1. Static rules (if provided) — first match wins
 * 2. Permission handler (mode-based)
 * 3. Denial tracking — auto-downgrade to 'ask' after too many denials
 */
export async function checkToolPermission(
  tool: string,
  input: unknown,
  context: PermissionContext,
  mode: PermissionMode,
  handler?: PermissionHandler,
  options?: CheckToolPermissionOptions
): Promise<PermissionDecision> {
  // Step 1: Check static rules first
  if (options?.rules?.length) {
    const ruleDecision = evaluateRules(tool, input, options.rules);
    if (ruleDecision) {
      // Track denial/allow for denial tracking
      if (options.denialTracking) {
        if (ruleDecision.behavior === 'deny') {
          recordDenial(options.denialTracking, options.denialLimits);
        } else if (ruleDecision.behavior === 'allow') {
          recordAllow(options.denialTracking);
        }
      }
      return ruleDecision;
    }
  }

  // Step 2: Use mode-based handler
  const effectiveHandler = getHandlerForMode(mode, handler);
  const decision = await effectiveHandler.checkPermission(tool, input, context);

  // Step 3: Denial tracking
  if (options?.denialTracking) {
    if (decision.behavior === 'deny') {
      const { shouldDowngrade } = recordDenial(options.denialTracking, options.denialLimits);
      if (shouldDowngrade) {
        // After too many denials, downgrade to 'ask' so the user gets a chance to intervene
        return {
          behavior: 'ask',
          message: 'Too many consecutive denials — requesting user confirmation',
        };
      }
    } else if (decision.behavior === 'allow') {
      recordAllow(options.denialTracking);
    }
  }

  return decision;
}
