import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Hiányzó környezeti változó: ${name}`);
  }
  return value;
}

export const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));

export const COMPANY_ID = required("SUPABASE_COMPANY_ID");
