/**
# Ohm Workspace features

To provide a hollistic IDE backing system, developers should be able to create an Ohm workspace.
The host will coordinate the platform, which provides filesystem durable operations, with the Ohm workspace, which provides generalized language operations.
This includes providing mass editing, maintaining diagnostics, etc.
 */


// Half open UTF16 span. 0 <= start < end. Length of span = end - start.
interface Span {
    start: number;
    end: number;
}

// Revisions for a file or text. sourceId must uniquely identify a single text over the course of the workspace' lifetime.
// Revision numbers are strictly incrementing, but not necessarily continuous, for a file.
// Revisions are used to identify valid operations, and an Ohm workspace will block operations on invalid revisions.
export interface Revision {
	sourceId: string;
	revision: number;
}

export interface Edit {
    revision: Revision;
    range: Span;
    text: string;
}

export interface Diagnostic {
    revision: Revision;
    span: Span;
    issue: Issue;
}

/**
 * When using a Workspace, pass source revision content in and the Workspace handles compiling,
 * builds cst/ast matches, runs (or at least exposes) semantics, tracks Diagnostics, etc.
 * Sources are keyed by revision as a mechanism to ensure lockstep file operations, while allowing
 * some missed edits. setRevisions only needs to send newer revisions, while applyEdits, getMatch,
 * etc needs to provide the exact revision that the workspace currently has.
 * 
 * ```mermaid
    sequenceDiagram
        participant Platform
        participant Host
        participant Workspace

        Host->>Platform: Read files
        Platform-->>Host: File edit notification

        Host->>Workspace: setRevisions(Iterable<[Revision, string]>)
        Host->>Workspace: applyEdits(Iterable<Edit>)
        Workspace->>Workspace: Resolve sources & validate edit batch
        Workspace->>Host: Return replacement texts
        Host->>Platform: Publish replacement texts
        Platform-->>Host: Publication result
        Host->>Workspace: setRevisions(Iterable<[Revision, string]>)

        Note over Host,Workspace: Invalid batch
        Host->>Workspace: applyEdits(invalid edits)
        Workspace->>Workspace: Validate entire batch<br/>Reject invalid ranges
        Workspace-->>Host: Error (No replacement results)
    ```
 */
export interface Workspace {
    readonly grammars: Grammar[];
    // Return diagnostics for a revision, or for all sources. `level` API to be refined.
    getDiagnostics(level: "all"|"semantic"|"syntax"|"lint", revision?: Revision): Diagnostic[];
    // Return the current match for a revision.
    getMatch(revision: Revision): Promise<Match>;
    // Validate that all Revisions are strictly greater than any currently stored revisions.
    // If a Revision isn't currently stored, set it. (Invariant: All sources are implicitly present,
    // with an empty text and initial revision 0). After setting revisions, update matches, diagnostics, etc.
	setRevisions(revisions: Iterable<[Revision, string]>): Promise<void>;
    // Validate all edit revisions are valid. Validate that all edits are non-overlapping. Apply
    // edits (in reverse order) to sources, then return the updated text _at the revision they were
    // edited_.
	applyEdits(edits: Iterable<Edit>): Promise<Iterable<[Revision, string]>>;
    // Return the suggested formatting of a given revision. If no formatting would change, the
    // revision is excluded in the response. Grammars without formatting hints would always noop.
	format(revisions?: Iterable<Revision>): Promise<Iterable<[Revision, string]>>;
}

export type buildWorkspace = (grammars: Grammar[], revisions?: Iterable<[Revision, string]>) => Workspace;