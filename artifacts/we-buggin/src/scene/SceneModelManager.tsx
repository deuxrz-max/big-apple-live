import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminSceneModelsQueryKey,
  getGetSceneModelsQueryKey,
  useGetAdminSceneModels,
  useUpdateSceneModelPlacement,
  useUploadSceneModel,
} from "@workspace/api-client-react";
import type { DeveloperSceneModel } from "@workspace/api-client-react";
import { useSceneModelLoadStatuses } from "./modelLoadStatus";
import "./scene-model-manager.css";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The model could not be saved.";
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayLoadState(model: DeveloperSceneModel, statuses: ReturnType<typeof useSceneModelLoadStatuses>) {
  const status = statuses[model.id];
  if (!status) return { label: "Waiting to load", percent: 0, error: "" };
  if (status.status === "loaded") return { label: "Loaded in scene", percent: 100, error: "" };
  if (status.status === "error") return { label: "Could not load", percent: 0, error: status.error?.message ?? "Check that this is a valid GLB/GLTF." };
  const percent = Math.round((status.progress ?? 0) * 100);
  return { label: status.status === "loading" ? "Loading in scene…" : `Loading in scene… ${percent}%`, percent, error: "" };
}

function SceneModelCard({
  model,
  onSavePlacement,
  pending,
}: {
  model: DeveloperSceneModel;
  onSavePlacement: (modelId: string, placement: { position: number[]; rotation: number[]; scale: number }) => Promise<void>;
  pending: boolean;
}) {
  const [position, setPosition] = useState(model.position.slice(0, 3).map(String));
  const [rotation, setRotation] = useState(model.rotation.slice(0, 3).map(String));
  const [scale, setScale] = useState(String(model.scale));
  const statuses = useSceneModelLoadStatuses();
  const load = displayLoadState(model, statuses);

  const save = () => {
    const vector = (values: string[]) => values.map((value) => Number(value));
    const positionValues = vector(position);
    const rotationValues = vector(rotation);
    const scaleValue = Number(scale);
    if ([...positionValues, ...rotationValues, scaleValue].some((value) => !Number.isFinite(value))
      || positionValues.length !== 3 || rotationValues.length !== 3) return;
    void onSavePlacement(model.id, { position: positionValues, rotation: rotationValues, scale: scaleValue });
  };

  return (
    <article className="st-scene-model-card" data-testid={`scene-model-${model.id}`}>
      <div className="st-scene-model-heading">
        <div className="st-scene-model-name">
          <strong>{model.name}</strong>
          <span>{model.format.toUpperCase()} · {formatBytes(model.byteSize)}</span>
        </div>
        <span className="st-scene-model-active"><i aria-hidden="true" /> In scene</span>
      </div>
      <div className="st-scene-model-load" aria-live="polite">
        <div className="st-scene-model-load-label"><span>{load.label}</span>{load.percent > 0 && <span>{load.percent}%</span>}</div>
        <div className="st-scene-model-progress" role="progressbar" aria-label={`${model.name} model loading progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={load.percent}>
          <span style={{ width: `${load.percent}%` }} />
        </div>
        {load.error && <small className="st-scene-model-error">{load.error}</small>}
      </div>
      <div className="st-scene-model-placement">
        <fieldset>
          <legend>Position</legend>
          {position.map((value, index) => (
            <label key={`p-${index}`}>{["X", "Y", "Z"][index]}
              <input aria-label={`${model.name} position ${["X", "Y", "Z"][index]}`} type="number" step="0.1"
                min={index === 1 ? -10 : -20} max={index === 1 ? 10 : 20} value={value}
                onChange={(event) => setPosition((current) => current.map((v, i) => i === index ? event.target.value : v))} />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Rotation</legend>
          {rotation.map((value, index) => (
            <label key={`r-${index}`}>{["X", "Y", "Z"][index]}
              <input aria-label={`${model.name} rotation ${["X", "Y", "Z"][index]}`} type="number" step="5" min="-360" max="360" value={value}
                onChange={(event) => setRotation((current) => current.map((v, i) => i === index ? event.target.value : v))} />
            </label>
          ))}
        </fieldset>
        <label className="st-scene-model-scale">Scale
          <input aria-label={`${model.name} scale`} type="number" step="0.1" min="0.1" max="4" value={scale}
            onChange={(event) => setScale(event.target.value)} />
        </label>
      </div>
      <button type="button" className="gs-button" onClick={save} disabled={pending}>
        {pending ? "Saving placement…" : "Save placement"}
      </button>
    </article>
  );
}

export function SceneModelManager() {
  const queryClient = useQueryClient();
  const modelList = useGetAdminSceneModels({
    query: { queryKey: getGetAdminSceneModelsQueryKey(), retry: false },
  });
  const upload = useUploadSceneModel();
  const placement = useUpdateSceneModelPlacement();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const models = useMemo(() => modelList.data?.models ?? [], [modelList.data?.models]);

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    setFile(next);
    setName(next.name.replace(/\.(glb|gltf)$/i, "").slice(0, 80));
    setMessage("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !name.trim()) {
      setMessage("Choose a GLB/GLTF file and give it a name.");
      return;
    }
    try {
      await upload.mutateAsync({ data: { name: name.trim(), model: file as unknown as string } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAdminSceneModelsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSceneModelsQueryKey() }),
      ]);
      setMessage(`“${name.trim()}” is saved and loading into the shared scene.`);
      setFile(null);
      setName("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const savePlacement = async (modelId: string, data: { position: number[]; rotation: number[]; scale: number }) => {
    try {
      await placement.mutateAsync({ modelId, data });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAdminSceneModelsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSceneModelsQueryKey() }),
      ]);
      setMessage("Scene placement saved.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <section className="gs-production-step st-scene-model-manager" aria-labelledby="st-scene-model-title">
      <header className="gs-production-step-head">
        <span className="gs-production-step-number">3D</span>
        <div>
          <h2 id="st-scene-model-title">Shared 3D scene</h2>
          <p>Upload self-contained GLB or GLTF models. Draco-compressed models are supported.</p>
        </div>
        <span className="gs-status">{models.length} models</span>
      </header>
      <form className="st-scene-model-upload" onSubmit={submit}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
      >
        <label className="st-scene-model-field">Model name
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Name this model" />
        </label>
        <input ref={inputRef} className="st-scene-model-file" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          aria-label="Choose GLB or GLTF model" onChange={(event) => chooseFile(event.target.files?.[0])} />
        <div className={`st-scene-model-drop${dragging ? " is-dragging" : ""}`}>
          <div>
            <strong>{file ? file.name : "Drop a model here"}</strong>
            <span>{file ? `${formatBytes(file.size)} · GLB/GLTF` : "or choose one file (up to 100 MB)"}</span>
          </div>
          <button type="button" className="gs-button" onClick={() => inputRef.current?.click()}>Choose model</button>
        </div>
        <p className="st-scene-model-note">GLTF files must contain their textures and buffers as embedded data. A single GLB is recommended.</p>
        <button type="submit" className="gs-button primary" disabled={!file || upload.isPending}>
          {upload.isPending ? "Uploading model…" : "Upload to shared scene"}
        </button>
        {message && <p className="st-scene-model-message" role="status" aria-live="polite">{message}</p>}
        {modelList.isError && <p className="st-scene-model-error" role="alert">Could not load the model list. {errorMessage(modelList.error)}</p>}
      </form>
      {modelList.isLoading ? <p className="gs-caption">Loading your scene models…</p>
        : models.length > 0
          ? <div className="st-scene-model-list">{models.map((model) => (
            <SceneModelCard key={model.id} model={model} onSavePlacement={savePlacement}
              pending={placement.isPending && placement.variables?.modelId === model.id} />
          ))}</div>
          : <p className="gs-caption">No custom models yet. Uploaded models appear behind the app for everyone.</p>}
    </section>
  );
}
