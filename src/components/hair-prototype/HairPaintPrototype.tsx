"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MiniWaffleHairScene, {
  type MiniWaffleHairSceneHandle,
} from "./MiniWaffleHairScene";
import FacePaintScene, { type FacePaintSceneHandle } from "./FacePaintScene";
import TopsPaintScene, { type TopsPaintSceneHandle } from "./TopsPaintScene";
import Toolbar from "./Toolbar";
import PaintToolControls from "./PaintToolControls";
import PresetPanel from "./PresetPanel";
import TextureIOPanel from "./TextureIOPanel";
import LayerPanel from "./LayerPanel";
import DebugPanel from "./DebugPanel";
import CharacterPanel from "./CharacterPanel";
import MorphPanel from "./MorphPanel";
import MorphCustomizer from "./MorphCustomizer";
import { useAvatarMorphs, type UseAvatarMorphsResult } from "./useAvatarMorphs";
import ToonStyleController from "./ToonStyleController";
import ToonDebugPanel from "./ToonDebugPanel";
import { loadToonSettings, lightIntensitiesFor, type ToonSettings } from "./toonStyle";
import AvatarAnimationScene, {
  type AvatarAnimationSceneHandle,
} from "./AvatarAnimationScene";
import AnimationTestPanel from "./AnimationTestPanel";
import type { AvatarAnimationDebugSnapshot, AvatarAnimationState } from "./avatarAnimation";
import { hairPresetStorage } from "./hairPresetStorage";
import { facePresetStorage } from "./facePresetStorage";
import { clothingPresetStorage } from "./clothingPresetStorage";
import { characterPresetStorage, type CharacterSummary } from "./characterPresetStorage";
import { devLog } from "../../lib/devLog";
import { downloadBlob } from "./textureIO";
import type { PresetMeta } from "./genericPresetStore";
import type { LayerSummary } from "./layerStackEngine";
import { MAX_LAYERS } from "./layerStackEngine";
import CosmeticAttachmentScene, {
  type CosmeticAttachmentSceneHandle,
  type CosmeticDebugInfo,
} from "./cosmetics/CosmeticAttachmentScene";
import CosmeticPaintScene, { type CosmeticPaintSceneHandle } from "./cosmetics/CosmeticPaintScene";
import CosmeticTransformControls from "./cosmetics/CosmeticTransformControls";
import CosmeticSelectionController from "./cosmetics/CosmeticSelectionController";
import CosmeticPanel, {
  type CosmeticGizmoMode,
  type CosmeticSubMode,
} from "./cosmetics/CosmeticPanel";
import { useCosmeticEditor } from "./cosmetics/useCosmeticEditor";
import { getCosmeticDefinition } from "./cosmetics/cosmeticRegistry";
import type { CosmeticMaterialSurface } from "./cosmetics/cosmeticAttachment";
import {
  INITIAL_DEBUG_INFO,
  INITIAL_FACE_DEBUG_INFO,
  INITIAL_HISTORY_STATUS,
  INITIAL_TOPS_DEBUG_INFO,
  DEFAULT_PRESET_ID,
  makeDefaultPresetMeta,
  emptyCharacterCosmetics,
  type CharacterAppearance,
  type CharacterCosmetics,
  type CosmeticCustomization,
  type DebugInfo,
  type EditMode,
  type FaceDebugInfo,
  type FaceLayerName,
  type HistoryStatus,
  type Mode,
  type PaintTool,
  type TextureImportMode,
  type Tool,
  type TopsDebugInfo,
} from "./types";

const INITIAL_COSMETIC_DEBUG_INFO: CosmeticDebugInfo = {
  headBoneFound: true,
  equippedId: null,
  hasArmature: false,
  hasUV: false,
  materialNames: [],
  meshNames: [],
};

const DEFAULT_HAIR_PRESET_META = makeDefaultPresetMeta("기본 (투명)");
const DEFAULT_FACE_PRESET_META = makeDefaultPresetMeta("기본");
const DEFAULT_TOPS_PRESET_META = makeDefaultPresetMeta("기본");

/**
 * Editor camera framing (rotation-bug fix). This used to be a static
 * `camera={{position:[0,1.3,3], fov:45}}` wrapped in a drei
 * `<Bounds fit clip observe>` that auto-recomputed camera position AND
 * `controls.target` every time the scene's bounding box changed. That box
 * came from `Box3.setFromObject()`, which for a SkinnedMesh only ever
 * inspects the mesh's cached, UNSKINNED bind-pose geometry transformed by
 * its static node matrixWorld chain - it never accounts for the actual
 * bone-driven skin deformation. This model's Armature root node carries a
 * baked +90 degree X rotation (a Blender->glTF axis-conversion artifact,
 * confirmed by inspecting the GLB's own node transforms) that the "root"
 * bone's own ~-90 degree counter-rotation correctly cancels out ONLY
 * through real skinning - so the character always rendered upright
 * (confirmed: DesktopAvatarScene, which never uses Bounds, shows the exact
 * same model correctly with a fixed camera - see desktopCameraConfig.ts),
 * but the naive Box3 Bounds computed was effectively rotated 90 degrees
 * from the true visual shape. That wrong box drove `controls.target` to
 * ~[0, 0.01, 0.23] (near the character's FEET, offset forward) instead of
 * its actual chest-height center - orbiting around that wrong, near-ground
 * pivot is what produced the reported "tumbling / mixed-axis" rotation.
 *
 * Fix: stop deriving the orbit target from an unskinned bounding box
 * entirely and manage it explicitly instead, exactly like Desktop already
 * does successfully for this same rig (DESKTOP_CAMERA_TARGET = [0, 0.25,
 * 0], "origin sits at the character's feet"). The Editor needs a wider,
 * further-back framing than Desktop's tight portrait crop (to show the
 * full body for Hair/Face/Tops/Cosmetic editing), so these are re-tuned
 * for that FOV/distance rather than reusing Desktop's numbers directly -
 * verified empirically via screenshots, not recomputed per frame.
 */
const EDITOR_CAMERA_POSITION: [number, number, number] = [0, 0.2, 0.95];
const EDITOR_CAMERA_FOV = 45;
const EDITOR_ORBIT_TARGET: [number, number, number] = [0, 0.2, 0];

interface LayerUIState {
  layers: LayerSummary[];
  activeLayerId: string;
}
const EMPTY_LAYER_STATE: LayerUIState = { layers: [], activeLayerId: "" };

const sidebarStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  background: "#1a1d24",
  borderRight: "1px solid #2a2e38",
  height: "100vh",
  overflowY: "auto",
  boxSizing: "border-box",
};

const dividerStyle: React.CSSProperties = {
  borderTop: "1px solid #2a2e38",
  margin: "4px 0",
};

const subTabButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "8px 8px",
  borderRadius: 8,
  border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
  background: active ? "#26314a" : "#20232b",
  color: active ? "#8fb8ff" : "#d6d9e0",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
});

export default function HairPaintPrototype() {
  const [editMode, setEditMode] = useState<EditMode>("rotate");

  // ---- Hair ------------------------------------------------------------
  const [hairTool, setHairTool] = useState<Tool>("brush");
  const [hairColor, setHairColor] = useState("#ff2d55");
  const [hairBrushSize, setHairBrushSize] = useState(24);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(INITIAL_DEBUG_INFO);
  const [hairHistory, setHairHistory] = useState<HistoryStatus>(INITIAL_HISTORY_STATUS);
  const [hairLayerState, setHairLayerState] = useState<LayerUIState>(EMPTY_LAYER_STATE);
  const [hairPresets, setHairPresets] = useState<PresetMeta[]>([]);
  const [hairActivePresetId, setHairActivePresetId] = useState<string | null>(
    DEFAULT_PRESET_ID
  );

  // ---- Face --------------------------------------------------------------
  const [faceTool, setFaceTool] = useState<PaintTool>("pen");
  const [faceColor, setFaceColor] = useState("#7a3b2e");
  const [faceBrushSize, setFaceBrushSize] = useState(6);
  const [faceMirrorEnabled] = useState(false);
  const [faceSubTarget, setFaceSubTarget] = useState<FaceLayerName>("base");
  const [faceDebugInfo, setFaceDebugInfo] = useState<FaceDebugInfo>(
    INITIAL_FACE_DEBUG_INFO
  );
  const [faceBaseHistory, setFaceBaseHistory] = useState<HistoryStatus>(INITIAL_HISTORY_STATUS);
  const [faceEyeHistory, setFaceEyeHistory] = useState<HistoryStatus>(INITIAL_HISTORY_STATUS);
  const [faceBaseLayerState, setFaceBaseLayerState] = useState<LayerUIState>(EMPTY_LAYER_STATE);
  const [faceEyeLayerState, setFaceEyeLayerState] = useState<LayerUIState>(EMPTY_LAYER_STATE);
  const [facePresets, setFacePresets] = useState<PresetMeta[]>([]);
  const [faceActivePresetId, setFaceActivePresetId] = useState<string | null>(
    DEFAULT_PRESET_ID
  );

  // ---- Tops --------------------------------------------------------------
  const [topsTool, setTopsTool] = useState<PaintTool>("pen");
  const [topsColor, setTopsColor] = useState("#3355ee");
  const [topsBrushSize, setTopsBrushSize] = useState(16);
  const [topsDebugInfo, setTopsDebugInfo] = useState<TopsDebugInfo>(
    INITIAL_TOPS_DEBUG_INFO
  );
  const [topsMaterialNames, setTopsMaterialNames] = useState<string[]>([]);
  const [topsActiveMaterial, setTopsActiveMaterial] = useState<string>("");
  const [topsHistories, setTopsHistories] = useState<Record<string, HistoryStatus>>({});
  const [topsLayerStates, setTopsLayerStates] = useState<Record<string, LayerUIState>>({});
  const [topsPresets, setTopsPresets] = useState<PresetMeta[]>([]);
  const [topsActivePresetId, setTopsActivePresetId] = useState<string | null>(
    DEFAULT_PRESET_ID
  );

  // ---- Characters ("My Characters") ---------------------------------------
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [activeCharacterId, setActiveCharacterIdState] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error"
  >("idle");
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string; name: string } | null>(
    null
  );
  const [morphNames, setMorphNames] = useState<string[]>([]);
  const [morphValues, setMorphValuesState] = useState<Record<string, number>>({});

  // ---- Toon rendering style (bug fix - "Toon Shading은 전역이 아니라
  // CharacterPreset에 저장되는 사용자별 외형 설정값") -------------------------
  // Used to be a single app-wide localStorage preference shared by every
  // character on the device (toonStyle.ts's loadToonSettings/
  // saveToonSettings), which made no sense once CoWork needed to show a
  // Remote Avatar with ITS OWNER's own Toon choice rather than whatever the
  // local viewer's device happened to have saved - see toonMaterialFactory.ts's
  // per-instance Toon apply and RemoteAvatarInstance.tsx. Now part of
  // CharacterAppearance (types.ts) exactly like morphValues/cosmetics
  // already are: initial value falls back through the OLD global
  // localStorage preference (loadToonSettings()) only as a one-time
  // migration bridge for a character saved before this field existed - see
  // applyCharacterAppearance below, which sets this on every character
  // load/switch. A change marks the character dirty (handleToonChange,
  // defined below markDirty to avoid a temporal-dead-zone reference) and
  // rides the EXISTING 1.5s autosave -> saveCurrentCharacter() ->
  // notifyPresetSaved() pipeline - the same single path every other
  // appearance edit already uses, rather than a second, separate save/
  // notify channel.
  const [toonSettings, setToonSettings] = useState<ToonSettings>(() => loadToonSettings());

  const hairSceneRef = useRef<MiniWaffleHairSceneHandle>(null);
  const faceSceneRef = useRef<FacePaintSceneHandle>(null);
  const topsSceneRef = useRef<TopsPaintSceneHandle>(null);
  const animationSceneRef = useRef<AvatarAnimationSceneHandle>(null);

  // Suppressed while a Character is being applied/created/initialized, so
  // the scenes' own "here is my initial state" callbacks (fired on every
  // mount and on every applyPreset/reset) never falsely mark a
  // freshly-loaded character as having unsaved changes.
  const suppressDirtyRef = useRef(true);
  const initializedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const saveCurrentCharacterRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const avatarMorphsRef = useRef<UseAvatarMorphsResult | null>(null);

  const hairMode: Mode = editMode === "hair" ? "draw" : "rotate";

  // ===== Debug / layer / history callbacks (stable identity) ==============
  const handleDebugUpdate = useCallback((patch: Partial<DebugInfo>) => {
    setDebugInfo((prev) => ({ ...prev, ...patch }));
  }, []);
  const handleFaceDebugUpdate = useCallback((patch: Partial<FaceDebugInfo>) => {
    setFaceDebugInfo((prev) => ({ ...prev, ...patch }));
  }, []);
  const handleTopsDebugUpdate = useCallback((patch: Partial<TopsDebugInfo>) => {
    setTopsDebugInfo((prev) => ({ ...prev, ...patch }));
  }, []);

  // Marks the active Character dirty and (re)starts the autosave debounce.
  // Every content-changing callback below (stroke end, layer ops, PNG
  // import, preset apply, reset, undo/redo, morph change) routes through
  // this - see section 13/14 of the Character brief. Suppressed during
  // startup/character-switch so the scenes' own mount-time "here is my
  // state" callbacks never falsely dirty a freshly-applied character.
  const markDirty = useCallback(() => {
    if (suppressDirtyRef.current) return;
    setDirty(true);
    setSaveStatus("unsaved");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      saveCurrentCharacterRef.current();
    }, 1500);
  }, []);

  const handleToonChange = useCallback(
    (patch: Partial<ToonSettings>) => {
      setToonSettings((prev) => ({ ...prev, ...patch }));
      markDirty();
    },
    [markDirty]
  );

  const handleHairHistoryChange = useCallback(
    (s: HistoryStatus) => {
      setHairHistory(s);
      markDirty();
    },
    [markDirty]
  );
  const handleHairLayersChange = useCallback(
    (layers: LayerSummary[], activeLayerId: string) => {
      setHairLayerState({ layers, activeLayerId });
      markDirty();
    },
    [markDirty]
  );

  const handleFaceHistoryChange = useCallback(
    (layer: FaceLayerName, status: HistoryStatus) => {
      if (layer === "base") setFaceBaseHistory(status);
      else setFaceEyeHistory(status);
      markDirty();
    },
    [markDirty]
  );
  const handleFaceLayersChange = useCallback(
    (layer: FaceLayerName, layers: LayerSummary[], activeLayerId: string) => {
      if (layer === "base") setFaceBaseLayerState({ layers, activeLayerId });
      else setFaceEyeLayerState({ layers, activeLayerId });
      markDirty();
    },
    [markDirty]
  );

  const handleTopsHistoryChange = useCallback(
    (materialName: string, status: HistoryStatus) => {
      setTopsHistories((prev) => ({ ...prev, [materialName]: status }));
      markDirty();
    },
    [markDirty]
  );
  const handleTopsLayersChange = useCallback(
    (materialName: string, layers: LayerSummary[], activeLayerId: string) => {
      setTopsLayerStates((prev) => ({ ...prev, [materialName]: { layers, activeLayerId } }));
      markDirty();
    },
    [markDirty]
  );
  const handleTopsMaterialsDiscovered = useCallback((names: string[]) => {
    setTopsMaterialNames(names);
    setTopsActiveMaterial((prev) => (prev && names.includes(prev) ? prev : names[0] ?? ""));
  }, []);

  // ===== Mode switching =====================================================
  const selectRotate = useCallback(() => setEditMode("rotate"), []);
  const selectHair = useCallback(() => setEditMode("hair"), []);
  const selectFace = useCallback(() => setEditMode("face"), []);
  const selectTops = useCallback(() => setEditMode("tops"), []);
  const selectCosmetic = useCallback(() => setEditMode("cosmetic"), []);

  // ===== Hair: tool + presets + I/O + layers ================================
  const selectHairPen = useCallback(() => setHairTool("brush"), []);
  const selectHairEraser = useCallback(() => setHairTool("eraser"), []);
  const hairUndo = useCallback(() => hairSceneRef.current?.undo(), []);
  const hairRedo = useCallback(() => hairSceneRef.current?.redo(), []);
  const hairReset = useCallback(() => {
    hairSceneRef.current?.resetToDefault();
    setHairActivePresetId(DEFAULT_PRESET_ID);
  }, []);

  const refreshHairPresets = useCallback(async () => {
    setHairPresets(await hairPresetStorage.listPresets());
  }, []);
  useEffect(() => {
    refreshHairPresets();
  }, [refreshHairPresets]);

  const hairSaveAsNew = useCallback(
    async (name: string) => {
      const handle = hairSceneRef.current;
      if (!handle) return;
      const { layers } = await handle.exportForPreset();
      const meta = await hairPresetStorage.savePreset(name, { schemaVersion: 2, layers });
      setHairActivePresetId(meta.id);
      await refreshHairPresets();
    },
    [refreshHairPresets]
  );
  const hairOverwriteById = useCallback(
    async (id: string) => {
      const handle = hairSceneRef.current;
      if (!handle) return;
      const { layers } = await handle.exportForPreset();
      await hairPresetStorage.overwritePreset(id, { schemaVersion: 2, layers });
      setHairActivePresetId(id);
      await refreshHairPresets();
    },
    [refreshHairPresets]
  );
  const hairOverwriteActive = useCallback(() => {
    if (hairActivePresetId && hairActivePresetId !== DEFAULT_PRESET_ID) {
      hairOverwriteById(hairActivePresetId);
    }
  }, [hairActivePresetId, hairOverwriteById]);
  const hairApplyPreset = useCallback(async (id: string) => {
    const handle = hairSceneRef.current;
    if (!handle) return;
    if (id === DEFAULT_PRESET_ID) {
      handle.resetToDefault();
      setHairActivePresetId(DEFAULT_PRESET_ID);
      return;
    }
    const record = await hairPresetStorage.loadPreset(id);
    if (!record) return;
    await handle.applyPresetLayers(record.data.layers);
    setHairActivePresetId(id);
  }, []);
  const hairRenamePreset = useCallback(
    async (id: string, name: string) => {
      await hairPresetStorage.renamePreset(id, name);
      await refreshHairPresets();
    },
    [refreshHairPresets]
  );
  const hairDeletePreset = useCallback(
    async (id: string) => {
      if (!window.confirm("이 머리 프리셋을 삭제할까요?")) return;
      await hairPresetStorage.deletePreset(id);
      if (hairActivePresetId === id) setHairActivePresetId(null);
      await refreshHairPresets();
    },
    [hairActivePresetId]
  );

  const hairDownloadUVGuide = useCallback(async () => {
    const blob = await hairSceneRef.current?.getUVGuideBlob();
    if (blob) downloadBlob(blob, "hair_uv_guide.png");
  }, []);
  const hairDownloadCurrent = useCallback(async () => {
    const blob = await hairSceneRef.current?.getCurrentTextureBlob();
    if (blob) downloadBlob(blob, "hair_current.png");
  }, []);
  const hairDownloadPaint = useCallback(async () => {
    const blob = await hairSceneRef.current?.getPaintLayerBlob();
    if (blob) downloadBlob(blob, "hair_paint.png");
  }, []);
  const hairDownloadActiveLayer = useCallback(async () => {
    const blob = await hairSceneRef.current?.getActiveLayerBlob();
    if (blob) downloadBlob(blob, "hair_layer.png");
  }, []);
  const hairUploadPNG = useCallback(
    async (file: File, _mode: TextureImportMode, target: "active" | "new") => {
      await hairSceneRef.current?.importPaintLayer(file, target);
      setHairActivePresetId(null);
    },
    []
  );

  // ===== Face: tool + presets + I/O + layers (base + eye) ===================
  const selectFacePen = useCallback(() => setFaceTool("pen"), []);
  const selectFaceEraser = useCallback(() => setFaceTool("eraser"), []);
  const faceUndo = useCallback(() => faceSceneRef.current?.undo(faceSubTarget), [faceSubTarget]);
  const faceRedo = useCallback(() => faceSceneRef.current?.redo(faceSubTarget), [faceSubTarget]);
  const faceReset = useCallback(() => {
    faceSceneRef.current?.resetToDefault(faceSubTarget);
    setFaceActivePresetId(DEFAULT_PRESET_ID);
  }, [faceSubTarget]);

  const refreshFacePresets = useCallback(async () => {
    setFacePresets(await facePresetStorage.listPresets());
  }, []);
  useEffect(() => {
    refreshFacePresets();
  }, [refreshFacePresets]);

  const faceSaveAsNew = useCallback(
    async (name: string) => {
      const handle = faceSceneRef.current;
      if (!handle) return;
      const data = await handle.exportForPreset();
      const meta = await facePresetStorage.savePreset(name, { schemaVersion: 2, ...data });
      setFaceActivePresetId(meta.id);
      await refreshFacePresets();
    },
    [refreshFacePresets]
  );
  const faceOverwriteById = useCallback(
    async (id: string) => {
      const handle = faceSceneRef.current;
      if (!handle) return;
      const data = await handle.exportForPreset();
      await facePresetStorage.overwritePreset(id, { schemaVersion: 2, ...data });
      setFaceActivePresetId(id);
      await refreshFacePresets();
    },
    [refreshFacePresets]
  );
  const faceOverwriteActive = useCallback(() => {
    if (faceActivePresetId && faceActivePresetId !== DEFAULT_PRESET_ID) {
      faceOverwriteById(faceActivePresetId);
    }
  }, [faceActivePresetId, faceOverwriteById]);
  const faceApplyPreset = useCallback(async (id: string) => {
    const handle = faceSceneRef.current;
    if (!handle) return;
    if (id === DEFAULT_PRESET_ID) {
      handle.resetToDefault("base");
      handle.resetToDefault("eye");
      setFaceActivePresetId(DEFAULT_PRESET_ID);
      return;
    }
    const record = await facePresetStorage.loadPreset(id);
    if (!record) return;
    await handle.applyPreset({
      baseLayers: record.data.baseLayers,
      eyeLayers: record.data.eyeLayers,
      baseOverrideTexture: record.data.baseOverrideTexture ?? null,
      eyeOverrideTexture: record.data.eyeOverrideTexture ?? null,
    });
    setFaceActivePresetId(id);
  }, []);
  const faceRenamePreset = useCallback(
    async (id: string, name: string) => {
      await facePresetStorage.renamePreset(id, name);
      await refreshFacePresets();
    },
    [refreshFacePresets]
  );
  const faceDeletePreset = useCallback(
    async (id: string) => {
      if (!window.confirm("이 얼굴 프리셋을 삭제할까요?")) return;
      await facePresetStorage.deletePreset(id);
      if (faceActivePresetId === id) setFaceActivePresetId(null);
      await refreshFacePresets();
    },
    [faceActivePresetId]
  );

  const faceDownloadUVGuide = useCallback((layer: FaceLayerName) => async () => {
    const blob = await faceSceneRef.current?.getUVGuideBlob(layer);
    if (blob) downloadBlob(blob, `face_${layer}_uv_guide.png`);
  }, []);
  const faceDownloadCurrent = useCallback((layer: FaceLayerName) => async () => {
    const blob = await faceSceneRef.current?.getCurrentTextureBlob(layer);
    if (blob) downloadBlob(blob, `face_${layer}_current.png`);
  }, []);
  const faceDownloadPaint = useCallback((layer: FaceLayerName) => async () => {
    const blob = await faceSceneRef.current?.getPaintLayerBlob(layer);
    if (blob) downloadBlob(blob, `face_${layer}_paint.png`);
  }, []);
  const faceDownloadActiveLayer = useCallback((layer: FaceLayerName) => async () => {
    const blob = await faceSceneRef.current?.getActiveLayerBlob(layer);
    if (blob) downloadBlob(blob, `face_${layer}_layer.png`);
  }, []);
  const faceUploadPNG = useCallback(
    (layer: FaceLayerName) =>
      async (file: File, mode: TextureImportMode, target: "active" | "new") => {
        const handle = faceSceneRef.current;
        if (!handle) return;
        if (mode === "paint-layer") await handle.importPaintLayer(layer, file, target);
        else await handle.importFullTexture(layer, file);
        setFaceActivePresetId(null);
      },
    []
  );

  // ===== Tops: tool + presets + I/O + layers ================================
  const selectTopsPen = useCallback(() => setTopsTool("pen"), []);
  const selectTopsEraser = useCallback(() => setTopsTool("eraser"), []);
  const topsUndo = useCallback(
    () => topsSceneRef.current?.undo(topsActiveMaterial),
    [topsActiveMaterial]
  );
  const topsRedo = useCallback(
    () => topsSceneRef.current?.redo(topsActiveMaterial),
    [topsActiveMaterial]
  );
  const topsReset = useCallback(() => {
    topsSceneRef.current?.resetToDefault(topsActiveMaterial);
    setTopsActivePresetId(DEFAULT_PRESET_ID);
  }, [topsActiveMaterial]);

  const refreshTopsPresets = useCallback(async () => {
    setTopsPresets(await clothingPresetStorage.listPresets());
  }, []);
  useEffect(() => {
    refreshTopsPresets();
  }, [refreshTopsPresets]);

  const topsSaveAsNew = useCallback(
    async (name: string) => {
      const handle = topsSceneRef.current;
      if (!handle) return;
      const { materials } = await handle.exportForPreset();
      const meta = await clothingPresetStorage.savePreset(name, {
        schemaVersion: 2,
        materials,
      });
      setTopsActivePresetId(meta.id);
      await refreshTopsPresets();
    },
    [refreshTopsPresets]
  );
  const topsOverwriteById = useCallback(
    async (id: string) => {
      const handle = topsSceneRef.current;
      if (!handle) return;
      const { materials } = await handle.exportForPreset();
      await clothingPresetStorage.overwritePreset(id, { schemaVersion: 2, materials });
      setTopsActivePresetId(id);
      await refreshTopsPresets();
    },
    [refreshTopsPresets]
  );
  const topsOverwriteActive = useCallback(() => {
    if (topsActivePresetId && topsActivePresetId !== DEFAULT_PRESET_ID) {
      topsOverwriteById(topsActivePresetId);
    }
  }, [topsActivePresetId, topsOverwriteById]);
  const topsApplyPreset = useCallback(async (id: string) => {
    const handle = topsSceneRef.current;
    if (!handle) return;
    if (id === DEFAULT_PRESET_ID) {
      for (const name of handle.getMaterialNames()) handle.resetToDefault(name);
      setTopsActivePresetId(DEFAULT_PRESET_ID);
      return;
    }
    const record = await clothingPresetStorage.loadPreset(id);
    if (!record) return;
    await handle.applyPreset({ materials: record.data.materials });
    setTopsActivePresetId(id);
  }, []);
  const topsRenamePreset = useCallback(
    async (id: string, name: string) => {
      await clothingPresetStorage.renamePreset(id, name);
      await refreshTopsPresets();
    },
    [refreshTopsPresets]
  );
  const topsDeletePreset = useCallback(
    async (id: string) => {
      if (!window.confirm("이 상의 프리셋을 삭제할까요?")) return;
      await clothingPresetStorage.deletePreset(id);
      if (topsActivePresetId === id) setTopsActivePresetId(null);
      await refreshTopsPresets();
    },
    [topsActivePresetId]
  );

  const topsDownloadUVGuide = useCallback((materialName: string) => async () => {
    const blob = await topsSceneRef.current?.getUVGuideBlob(materialName);
    if (blob) downloadBlob(blob, `tops_${materialName}_uv_guide.png`);
  }, []);
  const topsDownloadCurrent = useCallback((materialName: string) => async () => {
    const blob = await topsSceneRef.current?.getCurrentTextureBlob(materialName);
    if (blob) downloadBlob(blob, `tops_${materialName}_current.png`);
  }, []);
  const topsDownloadPaint = useCallback((materialName: string) => async () => {
    const blob = await topsSceneRef.current?.getPaintLayerBlob(materialName);
    if (blob) downloadBlob(blob, `tops_${materialName}_paint.png`);
  }, []);
  const topsDownloadActiveLayer = useCallback((materialName: string) => async () => {
    const blob = await topsSceneRef.current?.getActiveLayerBlob(materialName);
    if (blob) downloadBlob(blob, `tops_${materialName}_layer.png`);
  }, []);
  const topsUploadPNG = useCallback(
    (materialName: string) =>
      async (file: File, mode: TextureImportMode, target: "active" | "new") => {
        const handle = topsSceneRef.current;
        if (!handle) return;
        if (mode === "paint-layer") await handle.importPaintLayer(materialName, file, target);
        else await handle.importFullTexture(materialName, file);
        setTopsActivePresetId(null);
      },
    []
  );

  // ===== Cosmetics (액세서리/귀) ==============================================
  const [cosmeticSubMode, setCosmeticSubMode] = useState<CosmeticSubMode>("transform");
  const [cosmeticGizmoMode, setCosmeticGizmoMode] = useState<CosmeticGizmoMode>("translate");
  const [cosmeticSelected, setCosmeticSelected] = useState(false);
  const [isCosmeticDragging, setIsCosmeticDragging] = useState(false);
  const [cosmeticDebugInfo, setCosmeticDebugInfo] = useState<CosmeticDebugInfo>(
    INITIAL_COSMETIC_DEBUG_INFO
  );
  const [cosmeticSurfaces, setCosmeticSurfaces] = useState<CosmeticMaterialSurface[]>([]);
  const [cosmeticActiveMaterial, setCosmeticActiveMaterial] = useState("");
  const [cosmeticHistories, setCosmeticHistories] = useState<Record<string, HistoryStatus>>({});
  const [cosmeticLayerStates, setCosmeticLayerStates] = useState<Record<string, LayerUIState>>({});
  const [cosmeticTool, setCosmeticTool] = useState<PaintTool>("pen");
  const [cosmeticColor, setCosmeticColor] = useState("#ff2d55");
  const [cosmeticBrushSize, setCosmeticBrushSize] = useState(16);

  const cosmeticAttachmentRef = useRef<CosmeticAttachmentSceneHandle>(null);
  const cosmeticPaintRef = useRef<CosmeticPaintSceneHandle>(null);
  // Keyed by cosmeticId (section 12/16) - survives equip/unequip switches so
  // a previously-painted ear's Paint Layers are never lost while a
  // different ear is equipped. Populated from CharacterPreset on load
  // (applyCharacterAppearance) and merged back into gatherAppearance() on
  // every save; kept as a ref (not state) since its own contents never need
  // to drive a re-render by themselves.
  const cosmeticCustomizationsRef = useRef<Record<string, CosmeticCustomization>>({});

  const cosmeticEditor = useCosmeticEditor({ attachmentRef: cosmeticAttachmentRef, markDirty });

  const handleCosmeticDebugUpdate = useCallback((info: CosmeticDebugInfo) => {
    setCosmeticDebugInfo(info);
  }, []);

  // Fires once attach/detach actually settles (section 20 - no per-frame
  // polling). Refreshes the paint surfaces CosmeticPaintScene should build
  // engines for, restores any previously-saved paint for the
  // newly-equipped cosmetic (via the effect below, keyed on
  // `cosmeticSurfaces`), and lets the dedicated undo/redo stack apply a
  // pending transform it couldn't set synchronously (equip undo/redo, or a
  // CharacterPreset's saved transform on load).
  const handleCosmeticAttachmentChange = useCallback(() => {
    setCosmeticSurfaces(cosmeticAttachmentRef.current?.getSurfaces() ?? []);
    setCosmeticSelected(false);
    cosmeticEditor.onAttachmentSettled();
  }, [cosmeticEditor]);

  const handleEquipCosmetic = useCallback(
    async (id: string | null) => {
      // Deselect FIRST, synchronously, before any async work - so
      // CosmeticTransformControls' target drops to null (and drei's
      // TransformControls unmounts cleanly) a full commit ahead of
      // CosmeticAttachmentScene's own detach effect for the outgoing
      // cosmetic, rather than racing it (a stale/just-detached target
      // during that race is otherwise harmless but logs a console
      // warning - see the safety-net effect below for every OTHER path
      // that can change equippedId).
      setCosmeticSelected(false);
      const prevId = cosmeticEditor.equippedId;
      if (prevId && cosmeticPaintRef.current) {
        const materials = await cosmeticPaintRef.current.exportForPreset();
        cosmeticCustomizationsRef.current[prevId] = { materials };
      }
      cosmeticEditor.equip(id);
    },
    [cosmeticEditor]
  );

  // Safety net for every OTHER path that can change which cosmetic is
  // equipped (undo/redo of an equip action, resetAllToDefault, a
  // CharacterPreset load) - none of those go through handleEquipCosmetic
  // above, so this keeps "selected" from ever pointing at a cosmetic that
  // is no longer the one attached (section 7).
  useEffect(() => {
    setCosmeticSelected(false);
  }, [cosmeticEditor.equippedId]);

  // Restores a previously-saved ear's Paint Layers once its surfaces exist
  // (section 12/16) - runs for BOTH interactive equip-switching and
  // CharacterPreset load, since both paths funnel through the same
  // equippedId -> CosmeticAttachmentScene -> onAttachmentChange ->
  // cosmeticSurfaces chain. A no-op when nothing was ever saved for this
  // cosmeticId (fresh equip keeps its default blank layer).
  useEffect(() => {
    const id = cosmeticEditor.equippedId;
    if (!id || cosmeticSurfaces.length === 0) return;
    const stored = cosmeticCustomizationsRef.current[id];
    if (stored) cosmeticPaintRef.current?.applyPreset(stored.materials);
  }, [cosmeticSurfaces, cosmeticEditor.equippedId]);

  // Keeps the active material tab valid as the equipped cosmetic's own
  // material list changes (mirrors handleTopsMaterialsDiscovered).
  useEffect(() => {
    setCosmeticActiveMaterial((prev) =>
      prev && cosmeticDebugInfo.materialNames.includes(prev)
        ? prev
        : cosmeticDebugInfo.materialNames[0] ?? ""
    );
  }, [cosmeticDebugInfo.materialNames]);

  const handleCosmeticHistoryChange = useCallback(
    (materialName: string, status: HistoryStatus) => {
      setCosmeticHistories((prev) => ({ ...prev, [materialName]: status }));
      markDirty();
    },
    [markDirty]
  );
  const handleCosmeticLayersChange = useCallback(
    (materialName: string, layers: LayerSummary[], activeLayerId: string) => {
      setCosmeticLayerStates((prev) => ({ ...prev, [materialName]: { layers, activeLayerId } }));
      markDirty();
    },
    [markDirty]
  );

  const equippedCosmeticDefinition = cosmeticEditor.equippedId
    ? getCosmeticDefinition(cosmeticEditor.equippedId)
    : null;
  const cosmeticPaintDisabledReason = !equippedCosmeticDefinition
    ? null
    : !equippedCosmeticDefinition.paintable || !cosmeticDebugInfo.hasUV
      ? "이 액세서리는 페인팅할 수 없습니다"
      : null;
  const cosmeticLayerState = cosmeticLayerStates[cosmeticActiveMaterial] ?? EMPTY_LAYER_STATE;
  const cosmeticHistory = cosmeticHistories[cosmeticActiveMaterial] ?? INITIAL_HISTORY_STATUS;

  // W/E/R gizmo-mode shortcuts (section 5) - only while actually in the
  // cosmetic Transform sub-mode, and never while the user is typing into a
  // text field (character rename etc).
  useEffect(() => {
    if (editMode !== "cosmetic" || cosmeticSubMode !== "transform") return;
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "w" || e.key === "W") setCosmeticGizmoMode("translate");
      else if (e.key === "e" || e.key === "E") setCosmeticGizmoMode("rotate");
      else if (e.key === "r" || e.key === "R") setCosmeticGizmoMode("scale");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, cosmeticSubMode]);

  // ===== Characters ("My Characters") =======================================
  // A CharacterPreset is a self-contained snapshot of the whole character's
  // appearance at save time (gatherAppearance below always produces fresh
  // PNG Blobs from the *live* engines) - never a set of links to the
  // Hair/Face/Clothing presets used to build it, so editing/deleting those
  // later can never reach into an already-saved character.
  const refreshCharacters = useCallback(async () => {
    setCharacters(await characterPresetStorage.listCharacters());
  }, []);

  const gatherAppearance = useCallback(async (): Promise<CharacterAppearance | null> => {
    const hairHandle = hairSceneRef.current;
    const faceHandle = faceSceneRef.current;
    const topsHandle = topsSceneRef.current;
    if (!hairHandle || !faceHandle || !topsHandle) return null;
    const [hairData, faceData, topsData] = await Promise.all([
      hairHandle.exportForPreset(),
      faceHandle.exportForPreset(),
      topsHandle.exportForPreset(),
    ]);

    // Cosmetics (section 15/16): capture the CURRENTLY-equipped cosmetic's
    // live paint into the customizations map before reading it, so a save
    // taken mid-painting is never stale - then merge over the existing map
    // rather than replacing it, so OTHER, currently-unequipped cosmetics'
    // previously-saved paint is preserved untouched (e.g. cat ear paint
    // must survive a save taken while rabbit ears are equipped).
    const equippedId = cosmeticEditor.equippedId;
    if (equippedId && cosmeticPaintRef.current) {
      const materials = await cosmeticPaintRef.current.exportForPreset();
      cosmeticCustomizationsRef.current[equippedId] = { materials };
    }
    const cosmetics: CharacterCosmetics = {
      equipped: equippedId
        ? {
            head: {
              cosmeticId: equippedId,
              transform:
                cosmeticAttachmentRef.current?.getTransform() ??
                getCosmeticDefinition(equippedId)?.defaultTransform ?? {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
            },
          }
        : {},
      customizations: { ...cosmeticCustomizationsRef.current },
    };

    return {
      hair: { layers: hairData.layers },
      face: {
        base: { layers: faceData.baseLayers, overrideTexture: faceData.baseOverrideTexture },
        eye: { layers: faceData.eyeLayers, overrideTexture: faceData.eyeOverrideTexture },
      },
      clothing: { materials: topsData.materials },
      morphValues: faceHandle.getMorphValues(),
      cosmetics,
      toon: toonSettings,
    };
  }, [cosmeticEditor.equippedId, toonSettings]);

  // Failure here must never fail the character save itself (section 19) -
  // callers just persist `null` and the card shows a placeholder.
  const captureThumbnail = useCallback(async (): Promise<Blob | null> => {
    try {
      const canvas = rendererRef.current?.domElement;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const size = 256;
      const out = document.createElement("canvas");
      out.width = size;
      out.height = size;
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      const sw = canvas.width;
      const sh = canvas.height;
      const side = Math.min(sw, sh);
      ctx.drawImage(canvas, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
      return await new Promise<Blob | null>((resolve) =>
        out.toBlob((b) => resolve(b), "image/png")
      );
    } catch (err) {
      console.error("[Character] thumbnail capture failed", err);
      return null;
    }
  }, []);

  // Character switches must never carry Undo/Redo history from one
  // character into another (section 28) - each engine's undo/redo stacks
  // are wiped after the new appearance is in place.
  const clearAllHistory = useCallback(() => {
    hairSceneRef.current?.clearHistory();
    faceSceneRef.current?.clearHistory("base");
    faceSceneRef.current?.clearHistory("eye");
    for (const name of topsSceneRef.current?.getMaterialNames() ?? []) {
      topsSceneRef.current?.clearHistory(name);
    }
    avatarMorphsRef.current?.clearHistory();
    cosmeticPaintRef.current?.clearHistory();
    cosmeticEditor.clearCosmeticHistory();
  }, [cosmeticEditor]);

  const resetAllToDefault = useCallback(() => {
    hairSceneRef.current?.resetToDefault();
    faceSceneRef.current?.resetToDefault("base");
    faceSceneRef.current?.resetToDefault("eye");
    for (const name of topsSceneRef.current?.getMaterialNames() ?? []) {
      topsSceneRef.current?.resetToDefault(name);
    }
    faceSceneRef.current?.resetMorphToDefault();
    cosmeticCustomizationsRef.current = {};
    cosmeticEditor.setEquippedFromPreset(null);
  }, [cosmeticEditor]);

  const applyCharacterAppearance = useCallback(
    async (appearance: CharacterAppearance) => {
      suppressDirtyRef.current = true;
      const hairHandle = hairSceneRef.current;
      const faceHandle = faceSceneRef.current;
      const topsHandle = topsSceneRef.current;
      await Promise.all([
        hairHandle?.applyPresetLayers(appearance.hair.layers) ?? Promise.resolve(),
        faceHandle?.applyPreset({
          baseLayers: appearance.face.base.layers,
          eyeLayers: appearance.face.eye.layers,
          baseOverrideTexture: appearance.face.base.overrideTexture ?? null,
          eyeOverrideTexture: appearance.face.eye.overrideTexture ?? null,
        }) ?? Promise.resolve(),
        topsHandle?.applyPreset({ materials: appearance.clothing.materials }) ?? Promise.resolve(),
      ]);
      // Defensive: a CharacterPreset saved before morphValues existed (or
      // with a partially-populated map) must never crash - fall back to
      // "touch nothing" rather than assuming the field is always present.
      faceHandle?.setMorphValues(appearance.morphValues ?? {});
      setMorphValuesState(faceHandle?.getMorphValues() ?? {});

      // Toon (bug fix): a character saved before this field existed falls
      // back to whatever the OLD app-wide localStorage preference was
      // (one-time migration bridge - see the state's own doc comment
      // above), never straight to DEFAULT_TOON_SETTINGS, so switching to
      // an old character never looks like a surprise reset.
      setToonSettings(appearance.toon ?? loadToonSettings());

      // Cosmetics (section 15/16): a CharacterPreset written before
      // cosmetics existed has no `cosmetics` field at all - fall back to an
      // empty state rather than crashing (types.ts's migration already
      // guarantees this for anything read through characterPresetStorage,
      // but this function is defensive on its own too).
      const cosmetics = appearance.cosmetics ?? emptyCharacterCosmetics();
      cosmeticCustomizationsRef.current = { ...cosmetics.customizations };
      const equipped = cosmetics.equipped.head;
      const nextCosmeticId = equipped?.cosmeticId ?? null;
      // Bug fix (same pattern as DesktopAvatarScene's loadActiveCharacter):
      // when the character being switched TO happens to have the SAME
      // cosmeticId already equipped as the one being switched FROM, this
      // setEquippedFromPreset call is a no-op re-render-wise (equippedId
      // state doesn't change), so CosmeticAttachmentScene's [equippedId]
      // attach effect never re-fires and this character's own saved
      // transform/paint - held in `pendingTransformRef`/
      // `cosmeticCustomizationsRef` - silently never gets applied, leaving
      // the PREVIOUS character's transform/paint on screen. Re-apply
      // directly in that case; a normal id-changing switch (the common
      // case) still goes through the existing pending-transform/
      // onAttachmentSettled path below untouched.
      const sameCosmeticStillEquipped =
        nextCosmeticId !== null && cosmeticEditor.equippedId === nextCosmeticId;
      cosmeticEditor.setEquippedFromPreset(nextCosmeticId, equipped?.transform ?? null);
      if (sameCosmeticStillEquipped && equipped) {
        cosmeticAttachmentRef.current?.setTransform(equipped.transform);
        const stored = cosmeticCustomizationsRef.current[equipped.cosmeticId];
        if (stored) void cosmeticPaintRef.current?.applyPreset(stored.materials);
      }
      setCosmeticSelected(false);
      setCosmeticSubMode("transform");

      clearAllHistory();

      setHairActivePresetId(null);
      setFaceActivePresetId(null);
      setTopsActivePresetId(null);

      // Let the callbacks fired by the applies above (onStructureChange /
      // onHistoryChange) settle before un-suppressing dirty tracking.
      await new Promise((resolve) => setTimeout(resolve, 0));
      suppressDirtyRef.current = false;
      setDirty(false);
      setSaveStatus("saved");
    },
    [clearAllHistory, cosmeticEditor]
  );

  const saveCurrentCharacter = useCallback(
    async (targetId?: string) => {
      const id = targetId ?? activeCharacterId;
      if (!id) return;
      setSaveStatus("saving");
      try {
        const appearance = await gatherAppearance();
        if (!appearance) throw new Error("scenes not ready");
        const thumbnail = await captureThumbnail();
        await characterPresetStorage.saveCharacter(id, appearance, thumbnail);
        devLog("[Preset] save committed id=", id);
        setDirty(false);
        setSaveStatus("saved");
        await refreshCharacters();
        // Desktop Avatar sync - fires on every manual save AND every
        // autosave (markDirty's 1.5s debounce above also routes through
        // this function), so Desktop picks up edits without the user
        // needing to explicitly "save" first. No-op/absent outside
        // Electron (section 31).
        window.desktopAPI?.notifyPresetSaved();
      } catch (err) {
        console.error("[Character] save failed", err);
        setSaveStatus("error");
      }
    },
    [activeCharacterId, gatherAppearance, captureThumbnail, refreshCharacters]
  );

  useEffect(() => {
    saveCurrentCharacterRef.current = () => saveCurrentCharacter();
  }, [saveCurrentCharacter]);

  // Bug fix ("저장 직후 Editor를 빠르게 닫으면 마지막 수정이 사라짐"): Main
  // (electron/main.ts) intercepts the Editor window's close and asks this
  // callback to run before actually closing. If a debounced autosave is
  // still pending (dirty, timer not yet fired), cancel the timer and
  // await the real save directly instead - the window only finishes
  // closing once this resolves (or Main's own bounded timeout elapses,
  // whichever comes first). Absent outside Electron/on the Desktop window
  // (no-op there), same optional-chaining convention as every other
  // desktopAPI listener in this file.
  useEffect(() => {
    if (!window.desktopAPI?.onFlushBeforeClose) return;
    return window.desktopAPI.onFlushBeforeClose(async () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (dirty) {
        await saveCurrentCharacterRef.current();
      }
    });
  }, [dirty]);

  const saveCurrentAsNewCharacter = useCallback(
    async (name: string) => {
      setSaveStatus("saving");
      try {
        const appearance = await gatherAppearance();
        if (!appearance) throw new Error("scenes not ready");
        const thumbnail = await captureThumbnail();
        const record = await characterPresetStorage.createCharacter(name, appearance, thumbnail);
        setActiveCharacterIdState(record.id);
        characterPresetStorage.setActiveCharacterId(record.id);
        setDirty(false);
        setSaveStatus("saved");
        await refreshCharacters();
        window.desktopAPI?.notifyPresetSaved();
      } catch (err) {
        console.error("[Character] save-as-new failed", err);
        setSaveStatus("error");
      }
    },
    [gatherAppearance, captureThumbnail, refreshCharacters]
  );

  const createNewCharacter = useCallback(
    async (name: string) => {
      suppressDirtyRef.current = true;
      resetAllToDefault();
      clearAllHistory();
      setHairActivePresetId(DEFAULT_PRESET_ID);
      setFaceActivePresetId(DEFAULT_PRESET_ID);
      setTopsActivePresetId(DEFAULT_PRESET_ID);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const appearance = await gatherAppearance();
      if (!appearance) {
        suppressDirtyRef.current = false;
        return;
      }
      const thumbnail = await captureThumbnail();
      const record = await characterPresetStorage.createCharacter(name, appearance, thumbnail);
      setActiveCharacterIdState(record.id);
      characterPresetStorage.setActiveCharacterId(record.id);
      setMorphValuesState(faceSceneRef.current?.getMorphValues() ?? {});
      await refreshCharacters();

      suppressDirtyRef.current = false;
      setDirty(false);
      setSaveStatus("saved");
      window.desktopAPI?.notifyPresetSaved();
    },
    [resetAllToDefault, clearAllHistory, gatherAppearance, captureThumbnail, refreshCharacters]
  );

  // "+ 새 캐릭터" never silently discards unsaved work on the character
  // being left - if dirty, it's saved first (no extra dialog needed since
  // nothing about the OLD character is being thrown away).
  const handleCreateNewCharacter = useCallback(
    async (name: string) => {
      if (dirty) await saveCurrentCharacter();
      await createNewCharacter(name);
    },
    [dirty, saveCurrentCharacter, createNewCharacter]
  );

  const doSwitchCharacter = useCallback(
    async (id: string) => {
      const record = await characterPresetStorage.getCharacter(id);
      if (!record) return;
      await applyCharacterAppearance(record.appearance);
      setActiveCharacterIdState(id);
      characterPresetStorage.setActiveCharacterId(id);
      window.desktopAPI?.notifyPresetSaved();
    },
    [applyCharacterAppearance]
  );

  // Section 12: switching to another character while the current one has
  // unsaved changes must ask first, not silently discard them.
  const requestSwitchCharacter = useCallback(
    (id: string) => {
      if (id === activeCharacterId) return;
      if (dirty) {
        const target = characters.find((c) => c.id === id);
        setPendingSwitch({ id, name: target?.name ?? "" });
      } else {
        doSwitchCharacter(id);
      }
    },
    [activeCharacterId, dirty, characters, doSwitchCharacter]
  );

  const confirmSaveAndSwitch = useCallback(async () => {
    if (!pendingSwitch) return;
    const targetId = pendingSwitch.id;
    setPendingSwitch(null);
    await saveCurrentCharacter();
    await doSwitchCharacter(targetId);
  }, [pendingSwitch, saveCurrentCharacter, doSwitchCharacter]);

  const confirmDiscardAndSwitch = useCallback(() => {
    if (!pendingSwitch) return;
    const targetId = pendingSwitch.id;
    setPendingSwitch(null);
    doSwitchCharacter(targetId);
  }, [pendingSwitch, doSwitchCharacter]);

  const cancelSwitch = useCallback(() => setPendingSwitch(null), []);

  const duplicateCharacterCard = useCallback(
    async (id: string) => {
      const source = characters.find((c) => c.id === id);
      const newName = `${source?.name ?? "캐릭터"} 복사`;
      await characterPresetStorage.duplicateCharacter(id, newName);
      await refreshCharacters();
    },
    [characters, refreshCharacters]
  );

  const renameCharacterCard = useCallback(
    async (id: string, name: string) => {
      await characterPresetStorage.renameCharacter(id, name);
      await refreshCharacters();
    },
    [refreshCharacters]
  );

  const deleteCharacterCard = useCallback(
    async (id: string) => {
      const target = characters.find((c) => c.id === id);
      if (!window.confirm(`'${target?.name ?? ""}' 캐릭터를 삭제할까요?`)) return;
      await characterPresetStorage.deleteCharacter(id);
      const remaining = await characterPresetStorage.listCharacters();
      setCharacters(remaining);
      if (activeCharacterId === id) {
        if (remaining.length > 0) {
          await doSwitchCharacter(remaining[0].id);
        } else {
          // Section 18: the app always keeps at least one character slot.
          await createNewCharacter("캐릭터 1");
        }
      }
    },
    [characters, activeCharacterId, doSwitchCharacter, createNewCharacter]
  );

  const handleMorphChange = useCallback(
    (name: string, value: number) => {
      faceSceneRef.current?.setMorphValue(name, value);
      setMorphValuesState((prev) => ({ ...prev, [name]: value }));
      markDirty();
    },
    [markDirty]
  );

  const handleMorphReset = useCallback(() => {
    faceSceneRef.current?.resetMorphToDefault();
    setMorphValuesState(faceSceneRef.current?.getMorphValues() ?? {});
    markDirty();
  }, [markDirty]);

  // "이목구비" (facial feature) Shape Key customizer - built entirely on
  // top of the same faceSceneRef morph API and the same morphNames/
  // morphValues state the raw "Body Morph" debug panel above already uses,
  // so both UIs and CharacterPreset save/restore always agree.
  const avatarMorphs = useAvatarMorphs({
    faceSceneRef,
    ready: faceDebugInfo.bodyFound,
    morphNames,
    morphValues,
    setMorphValues: setMorphValuesState,
    markDirty,
  });
  useEffect(() => {
    avatarMorphsRef.current = avatarMorphs;
  });

  // Once Body's morph dictionary is known, populate the slider list/values
  // exactly once - character load/creation afterwards keeps them in sync
  // via their own setMorphValuesState calls above.
  useEffect(() => {
    if (!faceDebugInfo.bodyFound) return;
    setMorphNames(faceSceneRef.current?.getMorphNames() ?? []);
    setMorphValuesState(faceSceneRef.current?.getMorphValues() ?? {});
  }, [faceDebugInfo.bodyFound]);

  // Startup: once all three scenes have mounted and reported their default
  // state, resolve which Character should be active - the last one used
  // (persisted activeCharacterId), otherwise the first in the list,
  // otherwise auto-create "캐릭터 1" (section 18) - then apply it.
  useEffect(() => {
    if (initializedRef.current) return;
    const hairReady = !!hairSceneRef.current;
    const faceReady = faceDebugInfo.bodyFound;
    const topsReady = topsMaterialNames.length > 0;
    if (!hairReady || !faceReady || !topsReady) return;
    initializedRef.current = true;

    (async () => {
      devLog("[Preset] hydration start");
      const list = await characterPresetStorage.listCharacters();
      setCharacters(list);

      const lastId = characterPresetStorage.getActiveCharacterId();
      const target = (lastId && list.find((c) => c.id === lastId)) || list[0] || null;

      if (target) {
        const record = await characterPresetStorage.getCharacter(target.id);
        if (record) {
          await applyCharacterAppearance(record.appearance);
          setActiveCharacterIdState(record.id);
          characterPresetStorage.setActiveCharacterId(record.id);
          devLog("[Preset] hydration complete id=", record.id, "(existing)");
          return;
        }
      }
      devLog("[Preset] hydration complete - no existing preset found, creating default");
      await createNewCharacter("캐릭터 1");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceDebugInfo.bodyFound, topsMaterialNames]);

  // ===== Toon rendering: color management + lighting ========================
  // Only ever touched while Toon is ON, and restored to whatever the
  // renderer's own defaults were the moment it captured them - so Toon OFF
  // stays pixel-identical to the pre-toon rendering state (sections 5/39).
  const originalColorMgmtRef = useRef<{
    toneMapping: THREE.ToneMapping;
    outputColorSpace: THREE.ColorSpace;
  } | null>(null);

  useEffect(() => {
    const gl = rendererRef.current;
    if (!gl || !originalColorMgmtRef.current) return;
    if (toonSettings.enabled) {
      gl.toneMapping = THREE.NoToneMapping;
      gl.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      gl.toneMapping = originalColorMgmtRef.current.toneMapping;
      gl.outputColorSpace = originalColorMgmtRef.current.outputColorSpace;
    }
  }, [toonSettings.enabled]);

  // All three paint scenes report readiness the same way turn 6's
  // Character-init flow already does - reused here so ToonStyleController
  // never captures a material reference before Painting has finished
  // cloning/wiring it.
  const sceneReady = faceDebugInfo.bodyFound && topsMaterialNames.length > 0;

  const { ambient: ambientIntensity, key: keyLightIntensity, fill: fillLightIntensity } =
    lightIntensitiesFor(toonSettings, 0.8, 1.2, 0.4);

  // ===== Avatar animation ====================================================
  // UI never touches the AnimationMixer/AvatarAnimationController directly -
  // only through these two functions, which is exactly the API a future
  // room/timer status effect will call too (section 8/18 of the brief).
  const handleSetAnimationState = useCallback((state: AvatarAnimationState) => {
    animationSceneRef.current?.setAnimationState(state);
  }, []);
  const handlePlayTemporaryAnimation = useCallback((state: AvatarAnimationState) => {
    animationSceneRef.current?.playTemporaryAnimation(state);
  }, []);
  // Avatar Editor default is a frozen rest pose (see AvatarAnimationScene's
  // startInEditMode prop below) - this lets the dev test panel explicitly
  // return to that frozen state after trying an animation, since
  // setAnimationState/playTemporaryAnimation always leave edit mode.
  const handleEnterEditMode = useCallback(() => {
    animationSceneRef.current?.enterEditMode();
  }, []);

  // Dev-only debug readout (section 14). Polled on a slow interval rather
  // than every frame - the animation itself is driven imperatively inside
  // AvatarAnimationScene's useFrame and never touches React state, so this
  // is the only place a (low-frequency, ~3Hz) rerender happens at all.
  const [animationDebug, setAnimationDebug] = useState<AvatarAnimationDebugSnapshot | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const snapshot = animationSceneRef.current?.getDebugSnapshot();
      if (snapshot) setAnimationDebug(snapshot);
    }, 300);
    return () => clearInterval(id);
  }, []);

  const hairPresetsForUI: PresetMeta[] = [DEFAULT_HAIR_PRESET_META, ...hairPresets];
  const facePresetsForUI: PresetMeta[] = [DEFAULT_FACE_PRESET_META, ...facePresets];
  const topsPresetsForUI: PresetMeta[] = [DEFAULT_TOPS_PRESET_META, ...topsPresets];

  const faceLayerState = faceSubTarget === "base" ? faceBaseLayerState : faceEyeLayerState;
  const faceHistory = faceSubTarget === "base" ? faceBaseHistory : faceEyeHistory;
  const topsLayerState = topsLayerStates[topsActiveMaterial] ?? EMPTY_LAYER_STATE;
  const topsHistory = topsHistories[topsActiveMaterial] ?? INITIAL_HISTORY_STATUS;

  // Cosmetic Transform sub-mode keeps OrbitControls on (to view/select the
  // accessory) except during an active TransformControls drag (section 7) -
  // Paint sub-mode disables it entirely, matching Hair/Face/Tops' own
  // "painting disables orbit" convention.
  const orbitEnabled =
    editMode === "rotate" ||
    (editMode === "cosmetic" && cosmeticSubMode === "transform" && !isCosmeticDragging);

  const currentHistoryStatus =
    editMode === "hair"
      ? hairHistory
      : editMode === "face"
        ? faceHistory
        : editMode === "tops"
          ? topsHistory
          : editMode === "cosmetic" && cosmeticSubMode === "paint"
            ? cosmeticHistory
            : INITIAL_HISTORY_STATUS;

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <div style={sidebarStyle}>
        <Toolbar
          editMode={editMode}
          onSelectRotate={selectRotate}
          onSelectHair={selectHair}
          onSelectFace={selectFace}
          onSelectTops={selectTops}
          onSelectCosmetic={selectCosmetic}
        />

        <div style={dividerStyle} />
        <CharacterPanel
          characters={characters}
          activeCharacterId={activeCharacterId}
          saveStatus={saveStatus}
          pendingSwitch={pendingSwitch}
          onSelectCharacter={requestSwitchCharacter}
          onConfirmSaveAndSwitch={confirmSaveAndSwitch}
          onConfirmDiscardAndSwitch={confirmDiscardAndSwitch}
          onCancelSwitch={cancelSwitch}
          onCreateNew={handleCreateNewCharacter}
          onSaveCurrent={() => saveCurrentCharacter()}
          onSaveAsNew={saveCurrentAsNewCharacter}
          onRename={renameCharacterCard}
          onDuplicate={duplicateCharacterCard}
          onDelete={deleteCharacterCard}
        />
        <MorphCustomizer morphs={avatarMorphs} />
        <MorphPanel
          morphNames={morphNames}
          morphValues={morphValues}
          onChange={handleMorphChange}
          onReset={handleMorphReset}
        />
        <ToonDebugPanel settings={toonSettings} onChange={handleToonChange} />
        <div style={dividerStyle} />
        <AnimationTestPanel
          onSetState={handleSetAnimationState}
          onPlayTemporary={handlePlayTemporaryAnimation}
          onEnterEditMode={handleEnterEditMode}
          debug={animationDebug}
        />

        {editMode === "hair" && (
          <>
            <div style={dividerStyle} />
            <PaintToolControls
              tool={hairTool === "brush" ? "pen" : "eraser"}
              color={hairColor}
              brushSize={hairBrushSize}
              minBrushSize={2}
              maxBrushSize={80}
              canUndo={hairHistory.canUndo}
              canRedo={hairHistory.canRedo}
              onSelectPen={selectHairPen}
              onSelectEraser={selectHairEraser}
              onColorChange={setHairColor}
              onBrushSizeChange={setHairBrushSize}
              onUndo={hairUndo}
              onRedo={hairRedo}
              onResetToDefault={hairReset}
            />
            <LayerPanel
              layers={hairLayerState.layers}
              activeLayerId={hairLayerState.activeLayerId}
              maxLayers={MAX_LAYERS}
              onSelectLayer={(id) => hairSceneRef.current?.selectLayer(id)}
              onCreateLayer={() => hairSceneRef.current?.createLayer()}
              onDeleteLayer={(id) => hairSceneRef.current?.deleteLayer(id)}
              onDuplicateLayer={(id) => hairSceneRef.current?.duplicateLayer(id)}
              onRenameLayer={(id, name) => hairSceneRef.current?.renameLayer(id, name)}
              onToggleVisible={(id, v) => hairSceneRef.current?.setLayerVisible(id, v)}
              onToggleLocked={(id, v) => hairSceneRef.current?.setLayerLocked(id, v)}
              onMoveUp={(id) => hairSceneRef.current?.moveLayerUp(id)}
              onMoveDown={(id) => hairSceneRef.current?.moveLayerDown(id)}
              onReorder={(ids) => hairSceneRef.current?.reorderLayers(ids)}
              onOpacityDragStart={(id) => hairSceneRef.current?.beginOpacityChange(id)}
              onOpacityChange={(id, v) => hairSceneRef.current?.setLayerOpacity(id, v)}
            />
            <PresetPanel
              presets={hairPresetsForUI}
              activePresetId={hairActivePresetId}
              onSaveAsNew={hairSaveAsNew}
              onOverwriteById={hairOverwriteById}
              onOverwriteActive={hairOverwriteActive}
              onApplyPreset={hairApplyPreset}
              onRenamePreset={hairRenamePreset}
              onDeletePreset={hairDeletePreset}
            />
            <TextureIOPanel
              label="외부 편집 - 머리"
              hasOriginalTexture={false}
              recommendedSize={1024}
              onDownloadUVGuide={hairDownloadUVGuide}
              onDownloadCurrentTexture={hairDownloadCurrent}
              onDownloadPaintLayer={hairDownloadPaint}
              onDownloadActiveLayer={hairDownloadActiveLayer}
              onUploadPNG={hairUploadPNG}
            />
          </>
        )}

        {editMode === "face" && (
          <>
            <div style={dividerStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={subTabButtonStyle(faceSubTarget === "base")}
                onClick={() => setFaceSubTarget("base")}
              >
                BASE
              </button>
              <button
                style={subTabButtonStyle(faceSubTarget === "eye")}
                onClick={() => setFaceSubTarget("eye")}
              >
                EYE
              </button>
            </div>
            <PaintToolControls
              tool={faceTool}
              color={faceColor}
              brushSize={faceBrushSize}
              minBrushSize={1}
              maxBrushSize={60}
              canUndo={faceHistory.canUndo}
              canRedo={faceHistory.canRedo}
              onSelectPen={selectFacePen}
              onSelectEraser={selectFaceEraser}
              onColorChange={setFaceColor}
              onBrushSizeChange={setFaceBrushSize}
              onUndo={faceUndo}
              onRedo={faceRedo}
              onResetToDefault={faceReset}
            />
            <LayerPanel
              layers={faceLayerState.layers}
              activeLayerId={faceLayerState.activeLayerId}
              maxLayers={MAX_LAYERS}
              onSelectLayer={(id) => faceSceneRef.current?.selectLayer(faceSubTarget, id)}
              onCreateLayer={() => faceSceneRef.current?.createLayer(faceSubTarget)}
              onDeleteLayer={(id) => faceSceneRef.current?.deleteLayer(faceSubTarget, id)}
              onDuplicateLayer={(id) => faceSceneRef.current?.duplicateLayer(faceSubTarget, id)}
              onRenameLayer={(id, name) =>
                faceSceneRef.current?.renameLayer(faceSubTarget, id, name)
              }
              onToggleVisible={(id, v) =>
                faceSceneRef.current?.setLayerVisible(faceSubTarget, id, v)
              }
              onToggleLocked={(id, v) =>
                faceSceneRef.current?.setLayerLocked(faceSubTarget, id, v)
              }
              onMoveUp={(id) => faceSceneRef.current?.moveLayerUp(faceSubTarget, id)}
              onMoveDown={(id) => faceSceneRef.current?.moveLayerDown(faceSubTarget, id)}
              onReorder={(ids) => faceSceneRef.current?.reorderLayers(faceSubTarget, ids)}
              onOpacityDragStart={(id) =>
                faceSceneRef.current?.beginOpacityChange(faceSubTarget, id)
              }
              onOpacityChange={(id, v) =>
                faceSceneRef.current?.setLayerOpacity(faceSubTarget, id, v)
              }
            />
            <PresetPanel
              presets={facePresetsForUI}
              activePresetId={faceActivePresetId}
              onSaveAsNew={faceSaveAsNew}
              onOverwriteById={faceOverwriteById}
              onOverwriteActive={faceOverwriteActive}
              onApplyPreset={faceApplyPreset}
              onRenamePreset={faceRenamePreset}
              onDeletePreset={faceDeletePreset}
            />
            <TextureIOPanel
              label="외부 편집 - BASE"
              hasOriginalTexture
              recommendedSize={faceDebugInfo.baseTextureSize}
              onDownloadUVGuide={faceDownloadUVGuide("base")}
              onDownloadCurrentTexture={faceDownloadCurrent("base")}
              onDownloadPaintLayer={faceDownloadPaint("base")}
              onDownloadActiveLayer={faceDownloadActiveLayer("base")}
              onUploadPNG={faceUploadPNG("base")}
            />
            <TextureIOPanel
              label="외부 편집 - EYE"
              hasOriginalTexture
              recommendedSize={faceDebugInfo.eyeTextureSize}
              onDownloadUVGuide={faceDownloadUVGuide("eye")}
              onDownloadCurrentTexture={faceDownloadCurrent("eye")}
              onDownloadPaintLayer={faceDownloadPaint("eye")}
              onDownloadActiveLayer={faceDownloadActiveLayer("eye")}
              onUploadPNG={faceUploadPNG("eye")}
            />
          </>
        )}

        {editMode === "tops" && (
          <>
            <div style={dividerStyle} />
            {topsMaterialNames.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {topsMaterialNames.map((name) => (
                  <button
                    key={name}
                    style={subTabButtonStyle(topsActiveMaterial === name)}
                    onClick={() => setTopsActiveMaterial(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <PaintToolControls
              tool={topsTool}
              color={topsColor}
              brushSize={topsBrushSize}
              minBrushSize={2}
              maxBrushSize={100}
              canUndo={topsHistory.canUndo}
              canRedo={topsHistory.canRedo}
              onSelectPen={selectTopsPen}
              onSelectEraser={selectTopsEraser}
              onColorChange={setTopsColor}
              onBrushSizeChange={setTopsBrushSize}
              onUndo={topsUndo}
              onRedo={topsRedo}
              onResetToDefault={topsReset}
            />
            {topsActiveMaterial && (
              <LayerPanel
                layers={topsLayerState.layers}
                activeLayerId={topsLayerState.activeLayerId}
                maxLayers={MAX_LAYERS}
                onSelectLayer={(id) =>
                  topsSceneRef.current?.selectLayer(topsActiveMaterial, id)
                }
                onCreateLayer={() => topsSceneRef.current?.createLayer(topsActiveMaterial)}
                onDeleteLayer={(id) =>
                  topsSceneRef.current?.deleteLayer(topsActiveMaterial, id)
                }
                onDuplicateLayer={(id) =>
                  topsSceneRef.current?.duplicateLayer(topsActiveMaterial, id)
                }
                onRenameLayer={(id, name) =>
                  topsSceneRef.current?.renameLayer(topsActiveMaterial, id, name)
                }
                onToggleVisible={(id, v) =>
                  topsSceneRef.current?.setLayerVisible(topsActiveMaterial, id, v)
                }
                onToggleLocked={(id, v) =>
                  topsSceneRef.current?.setLayerLocked(topsActiveMaterial, id, v)
                }
                onMoveUp={(id) => topsSceneRef.current?.moveLayerUp(topsActiveMaterial, id)}
                onMoveDown={(id) =>
                  topsSceneRef.current?.moveLayerDown(topsActiveMaterial, id)
                }
                onReorder={(ids) =>
                  topsSceneRef.current?.reorderLayers(topsActiveMaterial, ids)
                }
                onOpacityDragStart={(id) =>
                  topsSceneRef.current?.beginOpacityChange(topsActiveMaterial, id)
                }
                onOpacityChange={(id, v) =>
                  topsSceneRef.current?.setLayerOpacity(topsActiveMaterial, id, v)
                }
              />
            )}
            <PresetPanel
              presets={topsPresetsForUI}
              activePresetId={topsActivePresetId}
              onSaveAsNew={topsSaveAsNew}
              onOverwriteById={topsOverwriteById}
              onOverwriteActive={topsOverwriteActive}
              onApplyPreset={topsApplyPreset}
              onRenamePreset={topsRenamePreset}
              onDeletePreset={topsDeletePreset}
            />
            {topsMaterialNames.length === 0 && (
              <div style={{ fontSize: 12, color: "#8b93a3" }}>
                Tops material을 확인하는 중...
              </div>
            )}
            {topsMaterialNames.map((materialName) => (
              <TextureIOPanel
                key={materialName}
                label={`외부 편집 - ${materialName}`}
                hasOriginalTexture
                recommendedSize={topsDebugInfo.textureWidth}
                onDownloadUVGuide={topsDownloadUVGuide(materialName)}
                onDownloadCurrentTexture={topsDownloadCurrent(materialName)}
                onDownloadPaintLayer={topsDownloadPaint(materialName)}
                onDownloadActiveLayer={topsDownloadActiveLayer(materialName)}
                onUploadPNG={topsUploadPNG(materialName)}
              />
            ))}
          </>
        )}

        {editMode === "cosmetic" && (
          <>
            <div style={dividerStyle} />
            <CosmeticPanel
              slot="head"
              equippedId={cosmeticEditor.equippedId}
              onEquip={handleEquipCosmetic}
              subMode={cosmeticSubMode}
              onSubModeChange={setCosmeticSubMode}
              paintDisabledReason={cosmeticPaintDisabledReason}
              gizmoMode={cosmeticGizmoMode}
              onGizmoModeChange={setCosmeticGizmoMode}
              onResetTransform={cosmeticEditor.resetTransform}
              headBoneMissing={!cosmeticDebugInfo.headBoneFound}
              canUndo={cosmeticEditor.canUndo}
              canRedo={cosmeticEditor.canRedo}
              onUndo={cosmeticEditor.undo}
              onRedo={cosmeticEditor.redo}
            />

            {cosmeticEditor.equippedId && cosmeticSubMode === "paint" && !cosmeticPaintDisabledReason && (
              <>
                {cosmeticDebugInfo.materialNames.length > 1 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {cosmeticDebugInfo.materialNames.map((name) => (
                      <button
                        key={name}
                        style={subTabButtonStyle(cosmeticActiveMaterial === name)}
                        onClick={() => setCosmeticActiveMaterial(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <PaintToolControls
                  tool={cosmeticTool}
                  color={cosmeticColor}
                  brushSize={cosmeticBrushSize}
                  minBrushSize={2}
                  maxBrushSize={80}
                  canUndo={cosmeticHistory.canUndo}
                  canRedo={cosmeticHistory.canRedo}
                  onSelectPen={() => setCosmeticTool("pen")}
                  onSelectEraser={() => setCosmeticTool("eraser")}
                  onColorChange={setCosmeticColor}
                  onBrushSizeChange={setCosmeticBrushSize}
                  onUndo={() => cosmeticPaintRef.current?.undo(cosmeticActiveMaterial)}
                  onRedo={() => cosmeticPaintRef.current?.redo(cosmeticActiveMaterial)}
                  onResetToDefault={() => cosmeticPaintRef.current?.resetToDefault(cosmeticActiveMaterial)}
                />
                {cosmeticActiveMaterial && (
                  <LayerPanel
                    layers={cosmeticLayerState.layers}
                    activeLayerId={cosmeticLayerState.activeLayerId}
                    maxLayers={MAX_LAYERS}
                    onSelectLayer={(id) => cosmeticPaintRef.current?.selectLayer(cosmeticActiveMaterial, id)}
                    onCreateLayer={() => cosmeticPaintRef.current?.createLayer(cosmeticActiveMaterial)}
                    onDeleteLayer={(id) => cosmeticPaintRef.current?.deleteLayer(cosmeticActiveMaterial, id)}
                    onDuplicateLayer={(id) =>
                      cosmeticPaintRef.current?.duplicateLayer(cosmeticActiveMaterial, id)
                    }
                    onRenameLayer={(id, name) =>
                      cosmeticPaintRef.current?.renameLayer(cosmeticActiveMaterial, id, name)
                    }
                    onToggleVisible={(id, v) =>
                      cosmeticPaintRef.current?.setLayerVisible(cosmeticActiveMaterial, id, v)
                    }
                    onToggleLocked={(id, v) =>
                      cosmeticPaintRef.current?.setLayerLocked(cosmeticActiveMaterial, id, v)
                    }
                    onMoveUp={(id) => cosmeticPaintRef.current?.moveLayerUp(cosmeticActiveMaterial, id)}
                    onMoveDown={(id) => cosmeticPaintRef.current?.moveLayerDown(cosmeticActiveMaterial, id)}
                    onReorder={(ids) => cosmeticPaintRef.current?.reorderLayers(cosmeticActiveMaterial, ids)}
                    onOpacityDragStart={(id) =>
                      cosmeticPaintRef.current?.beginOpacityChange(cosmeticActiveMaterial)
                    }
                    onOpacityChange={(id, v) =>
                      cosmeticPaintRef.current?.setLayerOpacity(cosmeticActiveMaterial, id, v)
                    }
                  />
                )}
              </>
            )}

            {process.env.NODE_ENV !== "production" && (
              <div style={{ fontSize: 11, color: "#8b93a3", lineHeight: 1.6, wordBreak: "break-all" }}>
                <div>cosmeticId: {cosmeticDebugInfo.equippedId ?? "(none)"}</div>
                <div>attachBone: {equippedCosmeticDefinition?.attachBone ?? "-"}</div>
                <div>headBoneFound: {String(cosmeticDebugInfo.headBoneFound)}</div>
                <div>hasArmature: {String(cosmeticDebugInfo.hasArmature)}</div>
                <div>hasUV: {String(cosmeticDebugInfo.hasUV)}</div>
                <div>materials: {cosmeticDebugInfo.materialNames.join(", ") || "-"}</div>
                <div>meshes: {cosmeticDebugInfo.meshNames.join(", ") || "-"}</div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <Canvas
          camera={{ position: EDITOR_CAMERA_POSITION, fov: EDITOR_CAMERA_FOV }}
          shadows={false}
          gl={{ preserveDrawingBuffer: true }}
          onCreated={(state) => {
            rendererRef.current = state.gl;
            originalColorMgmtRef.current = {
              toneMapping: state.gl.toneMapping,
              outputColorSpace: state.gl.outputColorSpace,
            };
            console.log("[ToonStyle] renderer defaults captured", originalColorMgmtRef.current);
            if (toonSettings.enabled) {
              state.gl.toneMapping = THREE.NoToneMapping;
              state.gl.outputColorSpace = THREE.SRGBColorSpace;
            }
          }}
        >
          <color attach="background" args={["#20232b"]} />
          <ambientLight intensity={ambientIntensity} />
          <directionalLight position={[3, 5, 4]} intensity={keyLightIntensity} />
          <directionalLight position={[-3, 2, -4]} intensity={fillLightIntensity} />

          <Suspense fallback={null}>
            <MiniWaffleHairScene
              ref={hairSceneRef}
              mode={hairMode}
              tool={hairTool}
              color={hairColor}
              brushSize={hairBrushSize}
              onDebugUpdate={handleDebugUpdate}
              onHistoryChange={handleHairHistoryChange}
              onLayersChange={handleHairLayersChange}
            />
            <FacePaintScene
              ref={faceSceneRef}
              editMode={editMode}
              tool={faceTool}
              color={faceColor}
              brushSize={faceBrushSize}
              mirrorEnabled={faceMirrorEnabled}
              onDebugUpdate={handleFaceDebugUpdate}
              onHistoryChange={handleFaceHistoryChange}
              onLayersChange={handleFaceLayersChange}
            />
            <TopsPaintScene
              ref={topsSceneRef}
              editMode={editMode}
              tool={topsTool}
              color={topsColor}
              brushSize={topsBrushSize}
              onDebugUpdate={handleTopsDebugUpdate}
              onHistoryChange={handleTopsHistoryChange}
              onLayersChange={handleTopsLayersChange}
              onMaterialsDiscovered={handleTopsMaterialsDiscovered}
            />
            <ToonStyleController ready={sceneReady} settings={toonSettings} />
            <AvatarAnimationScene ref={animationSceneRef} startInEditMode />

            <CosmeticAttachmentScene
              ref={cosmeticAttachmentRef}
              equippedId={cosmeticEditor.equippedId}
              onDebugUpdate={handleCosmeticDebugUpdate}
              onAttachmentChange={handleCosmeticAttachmentChange}
            />
            <CosmeticPaintScene
              ref={cosmeticPaintRef}
              surfaces={cosmeticSurfaces}
              active={editMode === "cosmetic" && cosmeticSubMode === "paint"}
              activeMaterialName={cosmeticActiveMaterial}
              tool={cosmeticTool}
              color={cosmeticColor}
              brushSize={cosmeticBrushSize}
              onHistoryChange={handleCosmeticHistoryChange}
              onLayersChange={handleCosmeticLayersChange}
            />
            {editMode === "cosmetic" && cosmeticSubMode === "transform" && (
              <>
                <CosmeticSelectionController
                  active={!!cosmeticEditor.equippedId && !isCosmeticDragging}
                  attachmentRef={cosmeticAttachmentRef}
                  onSelect={() => setCosmeticSelected(true)}
                  onDeselect={() => setCosmeticSelected(false)}
                />
                <CosmeticTransformControls
                  target={
                    cosmeticSelected
                      ? cosmeticAttachmentRef.current?.getAttachmentRoot() ?? null
                      : null
                  }
                  mode={cosmeticGizmoMode}
                  onDragStart={() => setIsCosmeticDragging(true)}
                  onDragEnd={(before, after) => {
                    setIsCosmeticDragging(false);
                    cosmeticEditor.commitTransformChange(before, after);
                  }}
                />
              </>
            )}
          </Suspense>

          <OrbitControls
            makeDefault
            enabled={orbitEnabled}
            enableDamping
            dampingFactor={0.1}
            target={EDITOR_ORBIT_TARGET}
            minDistance={0.3}
            maxDistance={3}
            minPolarAngle={Math.PI * 0.08}
            maxPolarAngle={Math.PI * 0.92}
          />
        </Canvas>

        <DebugPanel
          debugInfo={debugInfo}
          faceDebugInfo={faceDebugInfo}
          topsDebugInfo={topsDebugInfo}
          editMode={editMode}
          brushSize={
            editMode === "face"
              ? faceBrushSize
              : editMode === "tops"
                ? topsBrushSize
                : hairBrushSize
          }
          historyStatus={currentHistoryStatus}
        />
      </div>
    </div>
  );
}
