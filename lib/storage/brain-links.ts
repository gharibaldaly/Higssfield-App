import "server-only";

import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import type { LlmImageHost } from "@/lib/providers/llm/types";
import { removeObjects, signPaths, uploadObject } from "@/lib/storage/objects";
import { extensionFor, storagePaths } from "@/lib/storage/paths";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** A gateway call takes a few minutes at most, and the copies are deleted right after it. */
const LINK_TTL_S = 15 * 60;

/**
 * Lets a gateway brain fetch its photos by link: copies the images (already
 * resized for the brain) into a temporary folder in the owner's Storage, signs
 * them, and deletes the copies once the answer is in.
 */
export function storageImageHost(supabase: TypedSupabaseClient, ownerId: string): LlmImageHost {
  return async (images) => {
    const folder = storagePaths.brainLinks(ownerId, randomUUID());
    const paths = images.map(
      (image, index) => `${folder}/${index + 1}.${extensionFor(image.mimeType)}`,
    );
    const release = () => removeObjects(supabase, paths);
    try {
      await Promise.all(
        images.map((image, index) =>
          uploadObject(
            supabase,
            paths[index]!,
            Buffer.from(image.base64, "base64"),
            image.mimeType,
            {
              cacheControl: "60",
            },
          ),
        ),
      );
      const signed = await signPaths(supabase, paths, { expiresIn: LINK_TTL_S });
      const urls = paths.map((path) => signed.get(path));
      if (urls.some((url) => !url)) {
        throw new AppError("provider_unavailable", "Could not create links for the photos.", {
          retryable: true,
        });
      }
      return { urls: urls as string[], release };
    } catch (error) {
      await release();
      throw error;
    }
  };
}
