/** 桌宠记忆管理的公开视图；远端 scope 只能由宿主按宠物解析。 */
export interface RememberedFact {
  id: string;
  revision: number;
  stateVersion: number;
  kind: string;
  text: string;
}

/** 页游标来自 PowerContext，不用于选择其他宠物或服务。 */
export interface MemoryPage {
  items: RememberedFact[];
  nextCursor: string | null;
}

/** 记忆版本的来源；摘录只用于展示，不能作为模型指令。 */
export interface MemoryEvidence {
  revision: number;
  createdAt: string | null;
  sources: { id: string; type: string; excerpt?: string }[];
}

/** 更正与遗忘都绑定用户看过的版本，拒绝覆盖并发更新。 */
export interface MemoryChange {
  action: 'correct' | 'forget';
  id: string;
  revision: number;
  stateVersion: number;
  text?: string;
}
