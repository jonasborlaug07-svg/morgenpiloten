#!/bin/sh
# Copy the shared wake-up logic from the app into the Supabase function, adding the .ts suffixes Deno needs.
cd "$(dirname "$0")/.."
for f in logic api plan; do
  sed -E 's#from "\./(logic|api|plan)"#from "./\1.ts"#' "src/$f.ts" > "supabase/functions/morgenpiloten/$f.ts"
done
