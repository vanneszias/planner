/**
 * Returns the EventCoordinator stub for one event (docs/architecture.md).
 *
 * `jurisdiction` comes from the COORDINATOR_JURISDICTION var: "eu" in every
 * deployed Worker, and empty only in local dev, because workerd doesn't
 * implement jurisdictions. Never fall back silently: a deployed Worker with an
 * empty value would create objects outside the EU.
 */
export function coordinatorFor<T extends Rpc.DurableObjectBranded | undefined>(
	namespace: DurableObjectNamespace<T>,
	jurisdiction: string,
	eventId: string,
): DurableObjectStub<T> {
	const scoped = jurisdiction
		? namespace.jurisdiction(jurisdiction as DurableObjectJurisdiction)
		: namespace
	return scoped.get(scoped.idFromName(eventId))
}
