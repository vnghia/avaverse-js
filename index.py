import webview
import cv2
import base64
import mediapipe as mp
import numpy as np

mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
mp_holistic = mp.solutions.holistic


class Api:
    def __init__(self) -> None:
        self.window = None
        self.cap = None
        self.holistic = mp_holistic.Holistic(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            enable_segmentation=True,
        )

    def __del__(self):
        self.holistic.close()

    def set_window(self, window: webview.Window):
        self.window = window

    def get_video_path(self):
        if self.window:
            result = self.window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("Video Files (*.mp4;*.webm;*.avi)", "All files (*.*)"),
            )
            if result:
                self.cap = cv2.VideoCapture(result[0])
                self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                self.fps = self.cap.get(cv2.CAP_PROP_FPS)
                self.writer = cv2.VideoWriter(
                    "output.mp4",
                    cv2.VideoWriter_fourcc(*"MP4V"),
                    self.fps,
                    (self.width, self.height),
                )
                return (self.width, self.height)

    @staticmethod
    def landmark_to_list(lm, visibility=False):
        if not lm:
            return None
        return [
            {"x": data.x, "y": data.y, "z": data.z, "visibility": data.visibility}
            if visibility
            else {"x": data.x, "y": data.y, "z": data.z}
            for data in lm.landmark
        ]

    def process(self):
        if self.cap:
            success, image = self.cap.read()
            if not success:
                self.writer.release()
                return None
            self.current_image = image
            self.current_image.flags.writeable = False
            image_rgb = cv2.cvtColor(self.current_image, cv2.COLOR_BGR2RGB)
            result = self.holistic.process(image_rgb)
            if result.segmentation_mask is not None:
                mask = result.segmentation_mask.astype(np.uint8)
                self.current_image = cv2.inpaint(
                    self.current_image, mask, 5, flags=cv2.INPAINT_TELEA
                )
            image_uri = (
                "data:image/png;base64,"
                + base64.b64encode(cv2.imencode(".png", self.current_image)[1]).decode()
            )
            return {
                "image_uri": image_uri,
                "face_landmarks": self.landmark_to_list(result.face_landmarks),
                "pose_world_landmarks": self.landmark_to_list(
                    result.pose_world_landmarks, True
                ),
                "pose_landmarks": self.landmark_to_list(result.pose_landmarks, True),
                "left_hand_landmarks": self.landmark_to_list(
                    result.left_hand_landmarks
                ),
                "right_hand_landmarks": self.landmark_to_list(
                    result.right_hand_landmarks
                ),
            }

    def combine_result(self, render_result):
        if render_result:
            render_array = np.asarray(
                bytearray(
                    base64.b64decode(render_result[len("data:image/png;base64,") :])
                ),
                dtype=np.uint8,
            )
            render_image = cv2.resize(
                cv2.imdecode(
                    render_array,
                    cv2.IMREAD_UNCHANGED,
                ),
                (self.width, self.height),
            )
            mask = np.tile(
                np.expand_dims(render_image[..., 3] == 0, axis=-1), (1, 1, 4)
            )
            current_image = np.dstack(
                (
                    self.current_image,
                    255 * np.ones((self.height, self.width), dtype=np.uint8),
                )
            )
            final_image = cv2.cvtColor(
                np.where(mask, current_image, render_image), cv2.COLOR_BGRA2BGR
            )
        else:
            final_image = self.current_image
        self.writer.write(final_image)


def assign_window(api: Api, window: webview.Window):
    api.set_window(window)


if __name__ == "__main__":
    api = Api()
    window = webview.create_window("Avaverse", "index.html", js_api=api)
    webview.start(assign_window, (api, window), http_server=True, debug=True)
