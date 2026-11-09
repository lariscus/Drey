// The rename that keeps links intact (ADR-0059) lives in shared/ since req-167: Drey Service's vault_move runs it too.
export { LinkRewriter, type RenameVault } from '../shared/link-rewriter';
