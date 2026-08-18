/**
 * A small, per-view generation guard. Deferred DOM work must prove that it
 * still belongs to the view generation which scheduled it before it runs.
 */
export class GenerationToken {
	private generation = 0;

	current(): number {
		return this.generation;
	}

	invalidate(): number {
		this.generation += 1;
		return this.generation;
	}

	isCurrent(candidate: number): boolean {
		return candidate === this.generation;
	}
}
