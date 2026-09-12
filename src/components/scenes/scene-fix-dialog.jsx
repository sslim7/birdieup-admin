import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Eraser, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import SceneMapPicker from "@/components/scenes/scene-map-picker";
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  formatKstDateTime,
  readErrorMessage,
  readSceneCoords,
  readSceneTakenLocal,
  saveSceneLocation,
  sceneKey,
  sceneTitle,
  toTakenInputValue,
  toTakenLocal,
} from "@/services/sceneService";

/**
 * 장면 한 건의 위치·촬영일시를 손으로 넣는 다이얼로그.
 *
 * 폼 관례는 `@/components/posts/post-board` 의 PostEditorDialog 를 따른다
 * (canSubmit 로 저장 버튼 잠그기 · setField · 2단계 확인 · toast 문구).
 *
 * **이 화면에서 제일 중요한 것은 사진이다.** 좌표를 기억해 내는 단서가 그것뿐이라 원본을
 * 크게 띄우고, 지도와 입력 칸은 그 아래에 둔다.
 */

const EMPTY_FORM = { latitude: "", longitude: "", takenAt: "" };

/** 숫자 칸 하나를 읽는다. 비어 있으면 null, 숫자가 아니면 NaN 을 그대로 넘겨 검증에서 걸리게 한다. */
function readNumber(text) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

function inRange(value, [min, max]) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export default function SceneFixDialog({ scene, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  // 'location' | 'taken' | null — 어떤 값을 지우려는지. 확인 다이얼로그가 이걸 보고 뜬다.
  const [clearTarget, setClearTarget] = useState(null);
  const [clearing, setClearing] = useState(false);

  const key = sceneKey(scene);

  /**
   * 열 때마다 지금 값으로 폼을 채운다.
   *
   * 「보정 완료」 목록에서 연 장면은 **이미 넣어 둔 값을 고치러 온 것**이라, 빈 폼으로 열면
   * 직전에 무엇을 찍었는지 알 길이 없어 같은 자리를 다시 찍게 된다.
   *
   * ⚠ 다만 값이 목록 응답에 실려 온다는 보장이 아직 없다(sceneService 의 readSceneCoords 주석).
   *   못 읽으면 **빈 폼으로 열되 화면은 멀쩡히 돌아간다** — 그 상태에서도 비우기와 다시 찍기는
   *   그대로 되고, 아래 안내가 "덮어쓴다"고 알려 준다.
   */
  useEffect(() => {
    if (!open) return;
    const coords = readSceneCoords(scene);
    setForm({
      latitude: coords ? String(coords.latitude) : "",
      longitude: coords ? String(coords.longitude) : "",
      takenAt: toTakenInputValue(readSceneTakenLocal(scene)),
    });
    setSubmitting(false);
    setClearTarget(null);
    setClearing(false);
    // scene 은 key 가 같으면 같은 장면이다. 객체 정체성으로 의존성을 걸면 목록을 다시 받을
    // 때마다 폼이 초기화되어, 타이핑 중이던 값이 사라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const setField = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  /**
   * 지도에서 고른 좌표를 입력 칸에 옮긴다.
   *
   * 비동기(지도 이벤트) 뒤에 값을 바꾸므로 **함수형 갱신**을 쓴다 — 그 사이 다른 칸을 타이핑했다면
   * 클로저가 들고 있는 form 은 이미 낡았다.
   * 소수점 6자리면 10cm 수준이라 이 도구가 필요로 하는 정밀도를 한참 넘는다.
   */
  const handlePick = useCallback((pickedLat, pickedLng) => {
    setForm((prev) => ({
      ...prev,
      latitude: pickedLat.toFixed(6),
      longitude: pickedLng.toFixed(6),
    }));
  }, []);

  const latitude = readNumber(form.latitude);
  const longitude = readNumber(form.longitude);
  const coordsEmpty = latitude === null && longitude === null;
  const latitudeOk = inRange(latitude, LATITUDE_RANGE);
  const longitudeOk = inRange(longitude, LONGITUDE_RANGE);
  // 위·경도는 한 벌이다. 한쪽만 채운 상태는 "아직 덜 쓴 것"이라 저장을 막는다.
  const coordsOk = coordsEmpty || (latitudeOk && longitudeOk);

  /*
    촬영일시 칸의 상한. `uploadedAt` 은 RFC3339(UTC)라 그대로 쓸 수 없고, **Date 로 옮기면
    브라우저 시간대만큼 밀린다.** 앞 16자(`YYYY-MM-DDTHH:mm`)를 잘라 쓰면 그 자리의 글자를
    그대로 옮기는 셈이라 밀리지 않는다 — 이 화면이 촬영일시를 다루는 방식과 같은 규칙이다.
  */
  const uploadedAtInputValue =
    String(scene?.uploadedAt ?? "").slice(0, 16) || undefined;

  const takenLocal = toTakenLocal(form.takenAt);
  const takenEmpty = form.takenAt.trim() === "";
  const takenOk = takenEmpty || takenLocal !== null;

  // 아무것도 채우지 않은 채 저장하면 서버에 빈 요청이 간다. 채운 게 하나는 있어야 한다.
  const hasSomethingToSave =
    (!coordsEmpty && latitudeOk && longitudeOk) || takenLocal !== null;

  const canSubmit =
    Boolean(scene) &&
    !submitting &&
    !clearing &&
    coordsOk &&
    takenOk &&
    hasSomethingToSave;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await saveSceneLocation({
        sourceType: scene.sourceType,
        sourceId: scene.sourceId,
        feedId: scene.feedId,
        storagePath: scene.storagePath,
        // 서비스가 "둘 다 숫자일 때만" 싣는다. 비운 쪽은 건드리지 않는 것이 계약이다.
        latitude: coordsEmpty ? undefined : latitude,
        longitude: coordsEmpty ? undefined : longitude,
        takenLocal: takenLocal ?? undefined,
      });
      toast.success("장면 정보를 저장했습니다.");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(readErrorMessage(error, "저장에 실패했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  /** 좌표만 / 촬영일시만 지운다. 잘못 찍어 넣은 값을 되돌릴 유일한 길이다. */
  const handleClear = async () => {
    if (!scene || !clearTarget) return;

    setClearing(true);
    try {
      await saveSceneLocation({
        sourceType: scene.sourceType,
        sourceId: scene.sourceId,
        feedId: scene.feedId,
        storagePath: scene.storagePath,
        clearLocation: clearTarget === "location",
        clearTaken: clearTarget === "taken",
      });
      toast.success(
        clearTarget === "location"
          ? "위치를 비웠습니다."
          : "촬영일시를 비웠습니다.",
      );
      setClearTarget(null);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(readErrorMessage(error, "비우지 못했습니다."));
      setClearing(false);
    }
  };

  if (!scene) return null;

  const title = sceneTitle(scene);
  const isVideo = scene.mediaKind === "video";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !submitting && !clearing && onOpenChange(next)}
      >
        {/* 사진 + 지도 + 폼이라 세로가 길다. 내용 자체를 스크롤시킨다. */}
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl lg:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {scene.authorName || "작성자 미상"} ·{" "}
              {formatKstDateTime(scene.uploadedAt)} 올림
              {" · "}
              사진을 보고 기억나는 위치와 촬영일시를 넣어 주세요.
            </DialogDescription>
          </DialogHeader>

          {/* 원본 미디어. 좌표를 떠올릴 단서가 이것뿐이라 가장 크게 둔다. */}
          <div className="flex items-center justify-center rounded-xl bg-muted/40 p-2">
            {!scene.url ? (
              <p className="py-16 text-sm text-muted-foreground">
                원본을 불러올 수 없습니다.
              </p>
            ) : isVideo ? (
              <video
                src={scene.url}
                controls
                preload="metadata"
                className="max-h-[46vh] w-full rounded-lg bg-black"
              />
            ) : (
              <img
                src={scene.url}
                alt={`${title} 첨부 사진`}
                className="max-h-[46vh] w-full rounded-lg object-contain"
              />
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* ── 위치 ───────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="size-4 text-primary" />
                  위치
                </Label>
                {/* 이미 값이 있는 장면만 비울 수 있다. 없는 값을 지우는 버튼은 누를 일이 없다. */}
                {scene.hasLocation && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 rounded-xl text-xs"
                    onClick={() => setClearTarget("location")}
                    disabled={submitting || clearing}
                  >
                    <Eraser className="size-3.5" />
                    위치 비우기
                  </Button>
                )}
              </div>

              {scene.hasLocation && (
                <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {readSceneCoords(scene)
                    ? "이미 넣어 둔 위치를 불러왔어요. 지도를 다시 눌러 고치거나, 위에서 비울 수 있어요."
                    : "이 장면에는 이미 위치가 있어요. 새로 넣으면 덮어씁니다."}
                </p>
              )}

              <SceneMapPicker
                latitude={latitudeOk ? latitude : null}
                longitude={longitudeOk ? longitude : null}
                onPick={handlePick}
                // 검색창을 장면 이름으로 채워 둔다. **sceneTitle 이 아니라 원본 이름이다** —
                // 이름이 없는 라운드에 「라운딩」이 들어가면 엉뚱한 곳이 검색된다(그때는 빈 칸).
                defaultQuery={String(scene.sourceName ?? "").trim()}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="scene-latitude">위도</Label>
                  <Input
                    id="scene-latitude"
                    value={form.latitude}
                    onChange={(e) => setField("latitude", e.target.value)}
                    // number 입력은 휠 스크롤로 값이 굴러가서 쓰지 않는다. 숫자 자판만 띄운다.
                    inputMode="decimal"
                    placeholder="37.123456"
                    className="rounded-xl font-mono"
                    aria-invalid={form.latitude.trim() !== "" && !latitudeOk}
                    aria-describedby={
                      coordsOk ? undefined : "scene-coords-error"
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scene-longitude">경도</Label>
                  <Input
                    id="scene-longitude"
                    value={form.longitude}
                    onChange={(e) => setField("longitude", e.target.value)}
                    inputMode="decimal"
                    placeholder="127.123456"
                    className="rounded-xl font-mono"
                    aria-invalid={form.longitude.trim() !== "" && !longitudeOk}
                    aria-describedby={
                      coordsOk ? undefined : "scene-coords-error"
                    }
                  />
                </div>
              </div>

              {/* 프리필된 값을 지우고 저장하면 "지워질 것"이라 기대하기 쉽다. 그러나 빈 좌표는
                  계약상 "건드리지 않음"이라 아무 일도 일어나지 않는다 — 조용한 무동작이
                  가장 나쁜 결말이므로 다음 수단을 바로 알려 준다. */}
              {scene.hasLocation && coordsEmpty && (
                <p className="text-xs text-muted-foreground">
                  칸을 비우고 저장해도 위치는 지워지지 않아요. 지우려면 위의
                  「위치 비우기」를 쓰세요.
                </p>
              )}

              {!coordsOk && (
                // 입력 칸과 사유를 aria 로 묶어 둔다. 저장이 잠긴 이유를 화면 낭독으로도 알 수 있어야 한다.
                <p
                  id="scene-coords-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  위도(-90~90)와 경도(-180~180)를 둘 다 올바르게 넣어야 저장할
                  수 있어요.
                </p>
              )}
            </div>

            <Separator />

            {/* ── 촬영일시 ───────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="scene-taken-at"
                  className="flex items-center gap-2"
                >
                  <CalendarClock className="size-4 text-primary" />
                  촬영일시
                </Label>
                {scene.hasTakenAt && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 rounded-xl text-xs"
                    onClick={() => setClearTarget("taken")}
                    disabled={submitting || clearing}
                  >
                    <Eraser className="size-3.5" />
                    촬영일시 비우기
                  </Button>
                )}
              </div>

              {scene.hasTakenAt && (
                <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {readSceneTakenLocal(scene)
                    ? "이미 넣어 둔 촬영일시를 불러왔어요. 고치거나 위에서 비울 수 있어요."
                    : "이 장면에는 이미 촬영일시가 있어요. 새로 넣으면 덮어씁니다."}
                </p>
              )}

              {/*
                사진은 올리기 전에 찍는다 — 올린 날보다 뒤인 촬영일은 애초에 있을 수 없고
                서버도 그 값을 거절한다. 고를 수 없게 막아 두면 **저장을 누른 뒤에야 알게 되는
                일**이 없어진다(서버 문구가 그 사정을 말해 주지만, 만나지 않는 편이 낫다).
              */}
              <Input
                id="scene-taken-at"
                type="datetime-local"
                step="1"
                max={uploadedAtInputValue}
                value={form.takenAt}
                onChange={(e) => setField("takenAt", e.target.value)}
                className="w-full rounded-xl sm:w-72"
                aria-invalid={!takenOk}
              />
              {scene.hasTakenAt && takenEmpty && (
                <p className="text-xs text-muted-foreground">
                  칸을 비우고 저장해도 촬영일시는 지워지지 않아요. 지우려면 위의
                  「촬영일시 비우기」를 쓰세요.
                </p>
              )}

              {/* 시간대를 덧붙이지 않는다는 사실을 그대로 적는다(sceneService 의 utcOffsetMinutes 주석).
                  「한국 시간 기준」이라고 쓰면 해외에서 찍은 사진에 대해 거짓말이 된다. */}
              <p className="text-xs text-muted-foreground">
                사진을 찍은 그 자리의 시각을 적으면{" "}
                <b>적은 그대로 현지 시각으로</b> 남습니다. 시간대는 붙이지
                않으며, 지도도 이 벽시계를 그대로 씁니다. 비워 두면 촬영일시는
                건드리지 않습니다.
              </p>
            </div>

            <Separator />

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-bold"
                onClick={() => onOpenChange(false)}
                disabled={submitting || clearing}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="rounded-xl font-bold"
                disabled={!canSubmit}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 비우기 확인.
          편집 다이얼로그의 자식으로 중첩하지 않고 형제로 둔다 — Radix 는 각각 포털로 나가므로
          겹쳐 떠도 문제가 없고, 취소했을 때 폼이 입력값을 그대로 유지한다. */}
      <Dialog
        open={clearTarget !== null}
        onOpenChange={(next) => !clearing && !next && setClearTarget(null)}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {clearTarget === "location"
                ? "위치를 비울까요?"
                : "촬영일시를 비울까요?"}
            </DialogTitle>
            <DialogDescription>
              비우면 이 장면은 다시 「보정이 필요한 장면」으로 돌아갑니다.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium break-words">
            {title}
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              onClick={() => setClearTarget(null)}
              disabled={clearing}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 rounded-xl font-bold"
              onClick={handleClear}
              disabled={clearing}
            >
              {clearing && <Loader2 className="size-4 animate-spin" />}
              비우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
