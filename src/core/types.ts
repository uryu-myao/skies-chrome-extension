export interface WorkHours {
  start: number;
  end: number;
}

export type WorkDays = number[];

// Reserved for the next version — kept in the schema now to avoid a second migration.
export interface PersonInfo {
  name: string;
  initials: string;
  color: string;
  note: string;
}

// Reserved for the next version.
export interface Group {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  timezone: string;
  label: string;
  // The name the city was added with — what "Reset" in the city panel puts
  // back. Optional: data saved before it existed doesn't have it, and
  // defaultLabelOf() falls back to the current label.
  defaultLabel?: string;
  person: PersonInfo | null;
  workHours: WorkHours | null;
  workDays: WorkDays | null;
  includeInCoreTime: boolean;
  // Deprecated — no longer shown or editable. Kept in the schema because
  // freezeDisplayOrder() reads it once to carry the pinned-first order the
  // user last saw into `order`.
  pinned: boolean;
  groups: string[];
  // Position in the list, 0 = top. At runtime the entries array order is the
  // source of truth: saveAppData() writes each entry's index here and
  // loadAppData() sorts by it. Missing on data saved before manual ordering,
  // which is what tells migrate() to freeze the old display order first.
  order: number;
  // Not part of spec-v2's schema — kept as an optional extension so the
  // existing sunrise/sunset-driven card gradient survives the v1→v2 cutover.
  lat?: number;
  lon?: number;
}

export type SortOrder = 'manual' | 'offset' | 'name';
export type CoreTimePanelMode = 'always' | 'collapsed' | 'hidden';

export interface AppSettings {
  hour24: boolean;
  showSeconds: boolean;
  // Deprecated — manual order is the only order now. Kept for the same reason
  // as Entry.pinned: freezeDisplayOrder() needs it to reproduce the old order.
  sortOrder: SortOrder;
  referenceTimezone: string | null;
  defaultWorkHours: WorkHours;
  defaultWorkDays: WorkDays;
  coreTimePanel: CoreTimePanelMode;
  dstBannerEnabled: boolean;
  dstLeadDays: number;
  dstNotificationEnabled: boolean;
}

export interface AppData {
  version: 2;
  entries: Entry[];
  groups: Group[];
  settings: AppSettings;
}
