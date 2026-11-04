export interface Health {
  status: string;
}

export interface Project {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  screenshot_count: number;
}

export interface Screenshot {
  id: number;
  project_id: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  annotation_count: number;
  file_available: boolean;
  image_url: string;
  created_at: string;
}

export interface Annotation {
  id: number;
  screenshot_id: number;
  number: number;
  x: number;
  y: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface AnnotationInput {
  x: number;
  y: number;
  comment: string;
}
