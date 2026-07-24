import { ruleRepositoryClient, ResolveLayeredParams } from "../clients/ruleRepositoryClient";
import { RemotePolicy, SourceAssignmentTag } from "./types";
import { AssignmentTargetType } from "../types/domain";

export interface ResolvedStep {
  policy: RemotePolicy;
  sourceAssignment: SourceAssignmentTag;
}

export interface ResolveLayersResult {
  orderedSteps: ResolvedStep[];
  unresolvedLevels: AssignmentTargetType[];
  unresolvedRefs: { targetType: AssignmentTargetType; ref: unknown }[];
}

/**
 * Calls TLM's layered resolve, drops any level whose rule group didn't resolve to a live version
 * (surfacing it as `unresolvedLevels` rather than silently dropping it), orders the remaining
 * layers by assignment priority ASCENDING — so the highest-priority assignment (employee or site,
 * whichever has the larger `priority`) runs LAST and has final say — and flattens each layer's
 * policies (already in rule-group sequence) into one ordered pipeline.
 */
export async function resolveAndOrderLayers(params: ResolveLayeredParams): Promise<ResolveLayersResult> {
  const { layers } = await ruleRepositoryClient.resolveLayered(params);

  const unresolvedLevels: AssignmentTargetType[] = [];
  const unresolvedRefs: { targetType: AssignmentTargetType; ref: unknown }[] = [];

  const resolvedLayers = layers.filter((layer) => {
    if (layer.unresolved || !layer.ruleGroup) {
      unresolvedLevels.push(layer.targetType);
      return false;
    }
    for (const ref of layer.unresolvedRefs) {
      unresolvedRefs.push({ targetType: layer.targetType, ref });
    }
    return true;
  });

  resolvedLayers.sort((a, b) => a.assignment.priority - b.assignment.priority);

  const orderedSteps: ResolvedStep[] = resolvedLayers.flatMap((layer) =>
    layer.policies.map((policy) => ({
      policy,
      sourceAssignment: {
        assignmentId: layer.assignment._id,
        targetType: layer.targetType,
        priority: layer.assignment.priority,
        ruleGroupId: layer.ruleGroup!.ruleGroupId,
        ruleGroupVersion: layer.ruleGroup!.version,
      },
    }))
  );

  return { orderedSteps, unresolvedLevels, unresolvedRefs };
}
