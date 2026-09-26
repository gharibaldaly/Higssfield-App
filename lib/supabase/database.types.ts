/**
 * Database types for the Supabase client.
 *
 * Hand-maintained to mirror supabase/migrations (the Supabase CLI type
 * generator needs Docker, which is not available in every environment).
 * After changing a migration, update this file — or regenerate it with:
 *   supabase gen types typescript --linked > lib/supabase/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = {
  created_at: string;
  updated_at: string;
};

type InsertTimestamps = {
  created_at?: string;
  updated_at?: string;
};

type Rel<Name extends string, Columns extends string[], Target extends string> = {
  foreignKeyName: Name;
  columns: Columns;
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: ["id"];
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type ProductRow = Timestamps & {
  id: string;
  owner_id: string;
  name: string;
  product_line: "SECRET" | "HOURS" | "VOWS";
  piece_count: number;
  sku: string | null;
  notes: string | null;
  approved_dna_id: string | null;
  approved_sheet_id: string | null;
  is_favorite: boolean;
  archived_at: string | null;
};

export type ProductPieceRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  position: number;
  name: string;
};

export type SourcePhotoRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  piece_id: string;
  kind: "front" | "back" | "detail";
  label: string | null;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  position: number;
};

export type GarmentDnaRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  version: number;
  data: Json;
  status: "draft" | "approved" | "superseded";
  source: "llm" | "manual";
  llm_provider: string | null;
  llm_model: string | null;
  prompt_version: string | null;
  approved_at: string | null;
};

export type ColorwayRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  name: string;
  hex: string;
  source: "swatch" | "eyedropper" | "manual";
  swatch_path: string | null;
  sample_image_path: string | null;
  sample_point: Json | null;
  position: number;
};

export type ProductSheetRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  dna_id: string | null;
  version: number;
  status: "draft" | "generating" | "review" | "approved" | "failed";
  plan: Json | null;
  prompt: string | null;
  layout: Json;
  generation_id: string | null;
  approved_at: string | null;
};

export type ReferenceCropRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  sheet_id: string;
  kind: "front" | "back" | "detail" | "pieces" | "swatch" | "matching";
  label: string;
  box: Json;
  storage_path: string;
  width: number | null;
  height: number | null;
  position: number;
};

export type CatalogueJobRow = Timestamps & {
  id: string;
  owner_id: string;
  batch_id: string;
  product_id: string;
  job_type: "front_back" | "macro" | "colorways";
  status: "queued" | "preparing" | "generating" | "review" | "approved" | "failed" | "canceled";
  model_id: string;
  options: Json;
  style: Json;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type DirectorPresetRow = Timestamps & {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_builtin: boolean;
  controls: Json;
  video_settings: Json;
  rules: Json;
};

export type AdProjectRow = Timestamps & {
  id: string;
  owner_id: string;
  product_id: string;
  sheet_id: string | null;
  preset_id: string | null;
  name: string;
  brief: string;
  controls: Json;
  video_settings: Json;
  rules: Json;
  plan: Json | null;
  status: "draft" | "planned" | "generating" | "review" | "done";
};

export type ShotRow = Timestamps & {
  id: string;
  owner_id: string;
  ad_project_id: string;
  position: number;
  purpose: string;
  detail_shown: string;
  framing: string;
  angle: string;
  movement: string;
  placement: string | null;
  duration_s: number;
  reference_crop_ids: string[];
  prompt: string;
  overrides: Json;
  preview_frame_first: boolean;
  preview_generation_id: string | null;
  preview_approved: boolean;
  video_generation_id: string | null;
  status:
    | "draft"
    | "preview_generating"
    | "preview_ready"
    | "generating"
    | "ready"
    | "approved"
    | "failed";
};

export type GenerationRow = Timestamps & {
  id: string;
  owner_id: string;
  provider: "higgsfield" | "mock";
  model_id: string;
  endpoint: string;
  kind: "image" | "video";
  purpose:
    | "ghost_front"
    | "ghost_back"
    | "macro"
    | "colorway"
    | "product_sheet"
    | "shot_preview"
    | "shot_video"
    | "other";
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  prompt: string;
  params: Json;
  reference_paths: string[];
  provider_request_id: string | null;
  provider_status_url: string | null;
  provider_result_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  cost: number | null;
  cost_unit: "usd" | "credits" | null;
  error: string | null;
  note: string | null;
  review: Json | null;
  review_status: "pending" | "approved" | "rejected";
  is_favorite: boolean;
  approved_at: string | null;
  product_id: string | null;
  colorway_id: string | null;
  catalogue_job_id: string | null;
  slot: string | null;
  sheet_id: string | null;
  ad_project_id: string | null;
  shot_id: string | null;
  parent_id: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  last_polled_at: string | null;
  poll_attempts: number;
};

export type RenderJobRow = Timestamps & {
  id: string;
  owner_id: string;
  ad_project_id: string;
  status: "queued" | "claimed" | "rendering" | "completed" | "failed" | "canceled";
  timeline: Json;
  music_path: string | null;
  output_path: string | null;
  progress: number;
  error: string | null;
  worker_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
};

export type SettingsRow = Timestamps & {
  owner_id: string;
  llm_provider: "claude" | "gemini";
  claude_model: string | null;
  gemini_model: string | null;
  catalogue_style: Json;
  default_image_model: string | null;
  default_video_model: string | null;
  custom_models: Json;
  drive: Json;
};

// ---------------------------------------------------------------------------
// Insert / Update helpers: columns with database defaults become optional.
// ---------------------------------------------------------------------------

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type OwnedDefaults = "id" | "owner_id" | "created_at" | "updated_at";

type InsertOf<T, Optional extends keyof T> = WithOptional<T, Optional>;
type UpdateOf<T> = Partial<T>;

type Table<
  Row,
  Optional extends keyof Row,
  Relationships extends Rel<string, string[], string>[],
> = {
  Row: Row;
  Insert: InsertOf<Row, Optional> & InsertTimestamps;
  Update: UpdateOf<Row>;
  Relationships: Relationships;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      products: Table<
        ProductRow,
        | OwnedDefaults
        | "sku"
        | "notes"
        | "approved_dna_id"
        | "approved_sheet_id"
        | "is_favorite"
        | "archived_at",
        [
          Rel<"products_approved_dna_id_fkey", ["approved_dna_id"], "garment_dna">,
          Rel<"products_approved_sheet_id_fkey", ["approved_sheet_id"], "product_sheets">,
        ]
      >;
      product_pieces: Table<
        ProductPieceRow,
        OwnedDefaults,
        [Rel<"product_pieces_product_id_fkey", ["product_id"], "products">]
      >;
      source_photos: Table<
        SourcePhotoRow,
        OwnedDefaults | "label" | "width" | "height" | "size_bytes" | "position",
        [
          Rel<"source_photos_product_id_fkey", ["product_id"], "products">,
          Rel<"source_photos_piece_id_fkey", ["piece_id"], "product_pieces">,
        ]
      >;
      garment_dna: Table<
        GarmentDnaRow,
        | OwnedDefaults
        | "status"
        | "source"
        | "llm_provider"
        | "llm_model"
        | "prompt_version"
        | "approved_at",
        [Rel<"garment_dna_product_id_fkey", ["product_id"], "products">]
      >;
      colorways: Table<
        ColorwayRow,
        OwnedDefaults | "swatch_path" | "sample_image_path" | "sample_point" | "position",
        [Rel<"colorways_product_id_fkey", ["product_id"], "products">]
      >;
      product_sheets: Table<
        ProductSheetRow,
        OwnedDefaults | "dna_id" | "status" | "plan" | "prompt" | "generation_id" | "approved_at",
        [
          Rel<"product_sheets_product_id_fkey", ["product_id"], "products">,
          Rel<"product_sheets_dna_id_fkey", ["dna_id"], "garment_dna">,
          Rel<"product_sheets_generation_id_fkey", ["generation_id"], "generations">,
        ]
      >;
      reference_crops: Table<
        ReferenceCropRow,
        OwnedDefaults | "width" | "height" | "position",
        [
          Rel<"reference_crops_product_id_fkey", ["product_id"], "products">,
          Rel<"reference_crops_sheet_id_fkey", ["sheet_id"], "product_sheets">,
        ]
      >;
      catalogue_jobs: Table<
        CatalogueJobRow,
        OwnedDefaults | "batch_id" | "status" | "options" | "error" | "started_at" | "finished_at",
        [Rel<"catalogue_jobs_product_id_fkey", ["product_id"], "products">]
      >;
      director_presets: Table<
        DirectorPresetRow,
        OwnedDefaults | "description" | "is_builtin" | "rules",
        []
      >;
      ad_projects: Table<
        AdProjectRow,
        OwnedDefaults | "sheet_id" | "preset_id" | "brief" | "rules" | "plan" | "status",
        [
          Rel<"ad_projects_product_id_fkey", ["product_id"], "products">,
          Rel<"ad_projects_sheet_id_fkey", ["sheet_id"], "product_sheets">,
          Rel<"ad_projects_preset_id_fkey", ["preset_id"], "director_presets">,
        ]
      >;
      shots: Table<
        ShotRow,
        | OwnedDefaults
        | "placement"
        | "reference_crop_ids"
        | "overrides"
        | "preview_frame_first"
        | "preview_generation_id"
        | "preview_approved"
        | "video_generation_id"
        | "status",
        [
          Rel<"shots_ad_project_id_fkey", ["ad_project_id"], "ad_projects">,
          Rel<"shots_preview_generation_id_fkey", ["preview_generation_id"], "generations">,
          Rel<"shots_video_generation_id_fkey", ["video_generation_id"], "generations">,
        ]
      >;
      generations: Table<
        GenerationRow,
        | OwnedDefaults
        | "status"
        | "params"
        | "reference_paths"
        | "provider_request_id"
        | "provider_status_url"
        | "provider_result_url"
        | "storage_path"
        | "mime_type"
        | "width"
        | "height"
        | "duration_s"
        | "cost"
        | "cost_unit"
        | "error"
        | "note"
        | "review"
        | "review_status"
        | "is_favorite"
        | "approved_at"
        | "product_id"
        | "colorway_id"
        | "catalogue_job_id"
        | "slot"
        | "sheet_id"
        | "ad_project_id"
        | "shot_id"
        | "parent_id"
        | "submitted_at"
        | "completed_at"
        | "last_polled_at"
        | "poll_attempts",
        [
          Rel<"generations_product_id_fkey", ["product_id"], "products">,
          Rel<"generations_colorway_id_fkey", ["colorway_id"], "colorways">,
          Rel<"generations_catalogue_job_id_fkey", ["catalogue_job_id"], "catalogue_jobs">,
          Rel<"generations_sheet_id_fkey", ["sheet_id"], "product_sheets">,
          Rel<"generations_ad_project_id_fkey", ["ad_project_id"], "ad_projects">,
          Rel<"generations_shot_id_fkey", ["shot_id"], "shots">,
          Rel<"generations_parent_id_fkey", ["parent_id"], "generations">,
        ]
      >;
      render_jobs: Table<
        RenderJobRow,
        | OwnedDefaults
        | "status"
        | "timeline"
        | "music_path"
        | "output_path"
        | "progress"
        | "error"
        | "worker_id"
        | "claimed_at"
        | "finished_at",
        [Rel<"render_jobs_ad_project_id_fkey", ["ad_project_id"], "ad_projects">]
      >;
      settings: Table<
        SettingsRow,
        | "owner_id"
        | "created_at"
        | "updated_at"
        | "llm_provider"
        | "claude_model"
        | "gemini_model"
        | "default_image_model"
        | "default_video_model"
        | "custom_models"
        | "drive",
        []
      >;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
