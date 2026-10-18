import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Check, Dice5, FileBox, Trash2, UploadCloud } from "lucide-react";
import {
  getGetAdminGiftMotionsQueryKey,
  getGetSocialMeQueryKey,
  useDeleteGiftMotion,
  useGetAdminGiftMotions,
  useUploadGiftMotion,
} from "@workspace/api-client-react";
import type {
  DeveloperGiftMotion,
  DeveloperGiftMotionCategory,
  DeveloperGiftMotionPreset,
  DeveloperGiftMotionUploadInput,
} from "@workspace/api-client-react";
import { GiftMotionPreview } from "@/gifts/GiftMotionPreview";
import { createRandomGiftMotion, guessGiftMotionCategory } from "@/gifts/gift-motion-utils";
import "./gift-motion-studio.css";

const CATEGORIES: DeveloperGiftMotionCategory[] = ["vehicle", "character", "object", "logo"];
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function makeMotion(category: DeveloperGiftMotionCategory, animationIndex: number | null): DeveloperGiftMotionPreset {
  return { ...createRandomGiftMotion(category, animationIndex === null ? 0 : animationIndex + 1), animationIndex };
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function SavedMotionCard({ motion, onDelete, pending }: {
  motion: DeveloperGiftMotion;
  onDelete: (motion: DeveloperGiftMotion) => void;
  pending: boolean;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <article className="gms-saved-item" data-testid={`gift-motion-${motion.id}`}>
      <div className="gms-saved-main">
        <span className="gms-saved-glyph" aria-hidden="true">3D</span>
        <div className="gms-saved-copy">
          <strong>{motion.name}</strong>
          <span>{motion.active ? "ACTIVE" : "INACTIVE"} · {motion.category.toUpperCase()} · {motion.cost.toLocaleString()} coins · {motion.format.toUpperCase()} · {formatBytes(motion.byteSize)}</span>
          <span>{motion.motion.entry} → {motion.motion.exit} · 6.0 sec · {motion.animationNames.length} animations</span>
        </div>
      </div>
      <div className="gms-saved-actions">
        <button className="gms-button quiet" type="button" onClick={() => setPreviewing((value) => !value)} aria-expanded={previewing}>
          {previewing ? "Close preview" : "Preview"}
        </button>
        {!confirming
          ? <button className="gms-icon-button" type="button" onClick={() => setConfirming(true)} disabled={pending} aria-label={`Delete ${motion.name}`} title="Delete saved motion"><Trash2 size={16} /></button>
          : <>
            <button className="gms-button danger" type="button" onClick={() => onDelete(motion)} disabled={pending}>{pending ? "Deleting…" : "Confirm delete"}</button>
            <button className="gms-button quiet" type="button" onClick={() => setConfirming(false)} disabled={pending}>Keep</button>
          </>}
      </div>
      {previewing && <div className="gms-preview" style={{ gridColumn: "1 / -1" }}>
        <span className="gms-preview-corner">Saved motion preview</span>
        <GiftMotionPreview
          src={motion.fileUrl}
          category={motion.category}
          motion={motion.motion}
          loop
          onModelInfo={() => undefined}
          onProgress={() => undefined}
          onError={() => undefined}
          onFinish={() => undefined}
        />
        <div className="gms-preview-status"><span>{motion.format.toUpperCase()}</span><span>6.0 SEC LOOP</span></div>
      </div>}
    </article>
  );
}

export function GiftMotionStudio() {
  const queryClient = useQueryClient();
  const motionsQuery = useGetAdminGiftMotions({
    query: { queryKey: getGetAdminGiftMotionsQueryKey(), retry: false },
  });
  const upload = useUploadGiftMotion();
  const remove = useDeleteGiftMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [category, setCategory] = useState<DeveloperGiftMotionCategory>("object");
  const [motion, setMotion] = useState<DeveloperGiftMotionPreset>(() => makeMotion("object", null));
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<[number, number, number] | null>(null);
  const [progress, setProgress] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const analyzedSource = useRef("");

  const savedMotions = useMemo(() => motionsQuery.data?.motions ?? [], [motionsQuery.data?.motions]);
  const validCost = /^\d+$/.test(cost) && Number(cost) > 0;
  const supported = (candidate: File) => /\.(glb|gltf)$/i.test(candidate.name);

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  const chooseFile = (candidate?: File) => {
    if (!candidate) return;
    if (!supported(candidate)) {
      setFormError("Choose a .glb or .gltf model file.");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setFormError("This file is over the 100 MB upload limit.");
      return;
    }
    setFormError("");
    setStatus("");
    setPreviewError("");
    setAnimationNames([]);
    setDimensions(null);
    setProgress(0);
    analyzedSource.current = "";
    setFile(candidate);
    const guessed = guessGiftMotionCategory(candidate.name, [1, 1, 1]);
    setCategory(guessed);
    setName(candidate.name.replace(/\.(glb|gltf)$/i, "").slice(0, 60));
    setMotion(makeMotion(guessed, null));
    setLocalUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return URL.createObjectURL(candidate);
    });
  };

  const changeCategory = (next: DeveloperGiftMotionCategory) => {
    setCategory(next);
    setMotion((current) => ({ ...current, category: next }));
  };

  const shuffleMotion = () => setMotion(createRandomGiftMotion(category, animationNames.length));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!file || !localUrl) {
      setFormError("Choose a model before saving this gift motion.");
      return;
    }
    if (!name.trim() || name.trim().length > 60) {
      setFormError("Enter a name between 1 and 60 characters.");
      return;
    }
    if (!validCost) {
      setFormError("Coin cost must be a positive whole number.");
      return;
    }
    const input: DeveloperGiftMotionUploadInput = {
      name: name.trim(),
      cost: Number(cost),
      category,
      animationNames: JSON.stringify(animationNames),
      motion: JSON.stringify({ ...motion, category }),
      model: file as unknown as string,
    };
    try {
      const saved = await upload.mutateAsync({ data: input });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAdminGiftMotionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
      ]);
      setStatus(`“${saved.name}” is saved as an active gift.`);
      setFile(null);
      setLocalUrl((oldUrl) => {
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return "";
      });
      setName("");
      setCost("");
      setAnimationNames([]);
      setDimensions(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setFormError(readableError(error));
    }
  };

  const deleteMotion = async (saved: DeveloperGiftMotion) => {
    try {
      await remove.mutateAsync({ giftId: saved.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAdminGiftMotionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
      ]);
      setStatus(`“${saved.name}” has been deleted.`);
    } catch (error) {
      setFormError(readableError(error));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  return (
    <section className="gms" aria-label="Gift motion studio" data-testid="gift-motion-studio">
      <section className="gms-card" aria-labelledby="gms-create-title">
        <header className="gms-head">
          <span className="gms-head-mark" aria-hidden="true">3D</span>
          <div>
            <div className="gms-eyebrow">Owner tool · Gift motion</div>
            <h2 id="gms-create-title">Build a 3D gift</h2>
            <p>Shape a six-second entrance, flight and finish. The saved motion becomes available as an active gift.</p>
          </div>
        </header>

        <div className="gms-create-layout">
          <div>
            <div className="gms-preview" aria-label="Local 3D model preview">
              <span className="gms-preview-corner">Live model stage</span>
              {!localUrl
                ? <div className="gms-preview-empty"><i aria-hidden="true" /><b>Your model, in motion</b><span>Choose a GLB or GLTF to inspect it before it enters the gift catalog.</span></div>
                : <GiftMotionPreview
                  src={localUrl}
                  category={category}
                  motion={motion}
                  loop
                  onModelInfo={(info) => {
                    setAnimationNames(info.animationNames);
                    setDimensions(info.dimensions);
                    if (analyzedSource.current !== localUrl) {
                      analyzedSource.current = localUrl;
                      const suggested = guessGiftMotionCategory(file?.name ?? "", info.dimensions);
                      setCategory(suggested);
                      setMotion(makeMotion(suggested, info.animationNames.length ? 0 : null));
                    }
                  }}
                  onProgress={(value) => setProgress(Math.round(value * 100))}
                  onError={(message) => setPreviewError(message)}
                  onFinish={() => undefined}
                />}
              {localUrl && progress < 100 && <div className="gms-preview-progress" role="progressbar" aria-label="Model preview loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
              {previewError && <div className="gms-error-note" role="alert">Preview unavailable: {previewError}. Check that WebGL is enabled and the model is valid.</div>}
              <div className="gms-preview-status"><span>{file ? file.name.split(".").pop()?.toUpperCase() : "NO MODEL"}</span><span>{progress >= 100 ? "MODEL READY" : localUrl ? `${progress}% LOADED` : "WAITING FOR FILE"}</span></div>
            </div>
            {dimensions && <div className="gms-info-strip" aria-label="Model dimensions">
              <span>SIZE {dimensions.map((value) => Number(value).toFixed(2)).join(" × ")}</span>
              <span>{animationNames.length} CLIP{animationNames.length === 1 ? "" : "S"}</span>
            </div>}
          </div>

          <form className="gms-form" onSubmit={submit} noValidate>
            <div
              className={`gms-drop${dragging ? " is-dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
              onDrop={onDrop}
            >
              <input ref={fileInputRef} className="gms-file-hidden" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" aria-label="Choose a GLB or GLTF model" onChange={(event) => chooseFile(event.target.files?.[0])} />
              <div className="gms-file-summary">
                <strong>{file ? file.name : "Drop a model file here"}</strong>
                <span>{file ? `${formatBytes(file.size)} · ${file.name.split(".").pop()?.toUpperCase()} · local preview` : "One GLB or GLTF · maximum 100 MB"}</span>
              </div>
              <button className="gms-button" type="button" onClick={() => fileInputRef.current?.click()}><UploadCloud size={15} /> Choose model</button>
            </div>

            <label className="gms-field">Gift name
              <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Name this gift" autoComplete="off" />
            </label>
            <div className="gms-two-fields">
              <label className="gms-field">Category
                <select value={category} onChange={(event) => changeCategory(event.target.value as DeveloperGiftMotionCategory)}>
                  {CATEGORIES.map((item) => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}
                </select>
                <small>Suggested from the file name and model shape. Change it if needed.</small>
              </label>
              <label className="gms-field">Coin cost
                <input type="number" min="1" step="1" inputMode="numeric" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="e.g. 240" />
              </label>
            </div>

            <div className="gms-motion-box">
              <div className="gms-motion-heading"><strong>Motion preset</strong><span>6.0 SEC · {motion.speed.toFixed(2)}×</span></div>
              <div className="gms-motion-details">
                <span>IN {motion.entry.toUpperCase()}</span><span>OUT {motion.exit.toUpperCase()}</span>
                <span>SPIN {motion.spin.map((axis) => axis.toFixed(1)).join(" / ")}</span>
              </div>
              <div className="gms-buttons">
                <button className="gms-button" type="button" onClick={shuffleMotion}><Dice5 size={14} /> Shuffle preset</button>
              </div>
            </div>

            <div className="gms-field">
              <span>Animation clips</span>
              <small>Detected from the model. The preset selects one clip when available.</small>
              <div className="gms-animation-list" aria-live="polite">
                {animationNames.length
                  ? animationNames.map((clip, index) => <span key={`${clip}-${index}`} aria-current={motion.animationIndex === index ? "true" : undefined}>{clip}{motion.animationIndex === index ? " · selected" : ""}</span>)
                  : <span className="is-empty">{localUrl ? "No animation clips detected" : "Choose a model to inspect clips"}</span>}
              </div>
            </div>

            {formError && <p className="gms-status error" role="alert">{formError}</p>}
            {status && <p className="gms-status success" role="status" aria-live="polite">{status}</p>}
            <button className="gms-button primary full" type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? <><span>Uploading model…</span></> : <><Check size={15} /> Save as active gift</>}
            </button>
            <p className="gms-field"><small>GLTF files need textures and buffers embedded in the file. A single GLB is recommended.</small></p>
          </form>
        </div>
      </section>

      <section className="gms-card" aria-labelledby="gms-saved-title">
        <header className="gms-head">
          <span className="gms-head-mark" aria-hidden="true"><FileBox size={17} /></span>
          <div>
            <div className="gms-eyebrow">Catalog inventory</div>
            <h2 id="gms-saved-title">Saved gift motions</h2>
            <p>Active 3D gifts currently available in the catalog. Preview a model or remove it from the collection.</p>
          </div>
          <span className="gms-count">{savedMotions.length} {savedMotions.length === 1 ? "gift" : "gifts"}</span>
        </header>

        {motionsQuery.isLoading
          ? <div className="gms-library" aria-label="Loading saved gift motions" aria-busy="true"><div className="gms-skeleton" /><div className="gms-skeleton" /></div>
          : motionsQuery.isError
            ? <div className="gms-empty" role="alert">
              <b>Gift motions did not load</b>
              <span>{readableError(motionsQuery.error)}</span>
              <button className="gms-button" type="button" onClick={() => void motionsQuery.refetch()}>Try again</button>
            </div>
            : savedMotions.length
              ? <div className="gms-library">{savedMotions.map((saved) => (
                <SavedMotionCard key={saved.id} motion={saved} onDelete={(selected) => void deleteMotion(selected)} pending={remove.isPending && remove.variables?.giftId === saved.id} />
              ))}</div>
              : <div className="gms-empty">
                <ArrowDownToLine size={18} aria-hidden="true" />
                <b>No 3D gifts saved yet</b>
                <span>Upload a model above to make the first gift motion.</span>
              </div>}
      </section>
    </section>
  );
}

export default GiftMotionStudio;
