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
                self.width = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
                self.height = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
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
                return None
            image.flags.writeable = False
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = self.holistic.process(image_rgb)
            if result.segmentation_mask is not None:
                mask = result.segmentation_mask.astype(np.uint8)
                image = cv2.inpaint(image, mask, 5, flags=cv2.INPAINT_TELEA)
            image_uri = (
                "data:image/png;base64,"
                + base64.b64encode(cv2.imencode(".png", image)[1]).decode()
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


def assign_window(api: Api, window: webview.Window):
    api.set_window(window)


if __name__ == "__main__":
    api = Api()
    window = webview.create_window("Avaverse", "index.html", js_api=api)
    webview.start(assign_window, (api, window), http_server=True)
