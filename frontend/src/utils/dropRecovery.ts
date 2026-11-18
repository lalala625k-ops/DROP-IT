export interface DropRecoveryCandidate {
  id: string; kind: 'original' | 'backup' | 'draft' | 'salvage' | 'temporary'; path: string;
  status: 'complete' | 'partial' | 'unrecoverable'; saved_at: string;
  cards: number; groups: number; pins: number; reason?: string;
  issues: { url: string; reason: string }[]; warnings: string[];
}
export interface DropRecoveryOffer {
  inspection_id: string; source_path: string; recommended_id: string | null; candidates: DropRecoveryCandidate[];
}
export interface DropOpenChoice { inspection_id: string; candidate_id: string }
export class DropRecoveryRequired extends Error {
  constructor(public offer: DropRecoveryOffer) { super('请选择文件恢复版本'); }
}
export const canOpenOriginal = (candidate: DropRecoveryCandidate) => candidate.kind === 'original' && candidate.status === 'complete';
