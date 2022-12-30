const remap = Kalidokit.Utils.remap;
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

let open_video_btn = document.getElementById("open-video-btn");
let background = document.getElementById("background");
let renderer_canvas = document.getElementById("renderer");

// vrm
let current_vrm;

// renderer
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  canvas: renderer_canvas,
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);

// camera
const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 1000);
camera.position.set(0, 0.95, 1.96);

// control
const control = new THREE.OrbitControls(camera, renderer.domElement);
control.screenSpacePanning = true;
control.enabled = false;
control.target.set(0, 0.95, 0.0);
control.update();

// scene
const scene = new THREE.Scene();

// light
const light = new THREE.DirectionalLight(0xffffff);
light.position.set(1.0, 1.0, 1.0).normalize();
scene.add(light);

// main render loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  if (current_vrm) {
    // Update model to render physics
    current_vrm.update(clock.getDelta());
  }
  renderer.render(scene, camera);
}
animate();

// load character VRM
const gltf_loader = new THREE.GLTFLoader();
gltf_loader.crossOrigin = "anonymous";
gltf_loader.load(
  "https://cdn.glitch.com/29e07830-2317-4b15-a044-135e73c7f840%2FAshtra.vrm?v=1630342336981",
  (gltf) => {
    THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);
    THREE.VRM.from(gltf).then((vrm) => {
      scene.add(vrm.scene);
      current_vrm = vrm;
      current_vrm.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
    });
  },
  (progress) =>
    console.log(
      "Loading model...",
      100.0 * (progress.loaded / progress.total),
      "%"
    ),
  (error) => console.error(error)
);

// animate rotation
const rig_rotation = (
  name,
  rotation = { x: 0, y: 0, z: 0 },
  dampener = 1,
  lerp_amount = 0.3
) => {
  if (!current_vrm) {
    return;
  }
  const Part = current_vrm.humanoid.getBoneNode(
    THREE.VRMSchema.HumanoidBoneName[name]
  );
  if (!Part) {
    return;
  }

  let euler = new THREE.Euler(
    rotation.x * dampener,
    rotation.y * dampener,
    rotation.z * dampener,
    rotation.rotationOrder || "XYZ"
  );
  let quaternion = new THREE.Quaternion().setFromEuler(euler);
  Part.quaternion.slerp(quaternion, lerp_amount); // interpolate
};

// animate position
const rig_position = (
  name,
  position = { x: 0, y: 0, z: 0 },
  dampener = 1,
  lerp_amount = 0.3
) => {
  if (!current_vrm) {
    return;
  }
  const Part = current_vrm.humanoid.getBoneNode(
    THREE.VRMSchema.HumanoidBoneName[name]
  );
  if (!Part) {
    return;
  }
  let vector = new THREE.Vector3(
    position.x * dampener,
    position.y * dampener,
    position.z * dampener
  );
  Part.position.lerp(vector, lerp_amount); // interpolate
};

let old_look_target = new THREE.Euler();
const rig_face = (rigged_face) => {
  if (!current_vrm) {
    return;
  }
  rig_rotation("Neck", rigged_face.head, 0.7);

  // Blendshapes and Preset Name Schema
  const Blendshape = current_vrm.blendShapeProxy;
  const PresetName = THREE.VRMSchema.BlendShapePresetName;

  // Simple example without winking. Interpolate based on old blendshape, then stabilize blink with `Kalidokit` helper function.
  // for VRM, 1 is closed, 0 is open.
  rigged_face.eye.l = lerp(
    clamp(1 - rigged_face.eye.l, 0, 1),
    Blendshape.getValue(PresetName.Blink),
    0.5
  );
  rigged_face.eye.r = lerp(
    clamp(1 - rigged_face.eye.r, 0, 1),
    Blendshape.getValue(PresetName.Blink),
    0.5
  );
  rigged_face.eye = Kalidokit.Face.stabilizeBlink(
    rigged_face.eye,
    rigged_face.head.y
  );
  Blendshape.setValue(PresetName.Blink, rigged_face.eye.l);

  // Interpolate and set mouth blendshapes
  Blendshape.setValue(
    PresetName.I,
    lerp(rigged_face.mouth.shape.I, Blendshape.getValue(PresetName.I), 0.5)
  );
  Blendshape.setValue(
    PresetName.A,
    lerp(rigged_face.mouth.shape.A, Blendshape.getValue(PresetName.A), 0.5)
  );
  Blendshape.setValue(
    PresetName.E,
    lerp(rigged_face.mouth.shape.E, Blendshape.getValue(PresetName.E), 0.5)
  );
  Blendshape.setValue(
    PresetName.O,
    lerp(rigged_face.mouth.shape.O, Blendshape.getValue(PresetName.O), 0.5)
  );
  Blendshape.setValue(
    PresetName.U,
    lerp(rigged_face.mouth.shape.U, Blendshape.getValue(PresetName.U), 0.5)
  );

  //PUPILS
  //interpolate pupil and keep a copy of the value
  let look_target = new THREE.Euler(
    lerp(old_look_target.x, rigged_face.pupil.y, 0.4),
    lerp(old_look_target.y, rigged_face.pupil.x, 0.4),
    0,
    "XYZ"
  );
  old_look_target.copy(look_target);
  current_vrm.lookAt.applyer.lookAt(look_target);
};

// VRM character animator
const animate_vrm = (vrm, results, width, height) => {
  if (!vrm) {
    return;
  }
  // Take the results from `Holistic` and animate character based on its Face, Pose, and Hand Keypoints.
  let rigged_pose, rigged_left_hand, rigged_right_hand, rigged_face;

  const face_landmarks = results.face_landmarks;
  // Pose 3D Landmarks are with respect to Hip distance in meters
  const pose_3d_landmarks = results.pose_world_landmarks;
  // Pose 2D landmarks are with respect to videoWidth and videoHeight
  const pose_2d_landmarks = results.pose_landmarks;
  // Be careful, hand landmarks may be reversed
  const left_hand_landmarks = results.right_hand_landmarks;
  const right_hand_landmarks = results.left_hand_landmarks;

  // Animate Face
  if (face_landmarks) {
    rigged_face = Kalidokit.Face.solve(face_landmarks, {
      runtime: "mediapipe",
      imageSize: { width, height },
    });
    rig_face(rigged_face);
  }

  // Animate Pose
  if (pose_2d_landmarks && pose_3d_landmarks) {
    rigged_pose = Kalidokit.Pose.solve(pose_3d_landmarks, pose_2d_landmarks, {
      runtime: "mediapipe",
      imageSize: { width, height },
    });
    rig_rotation("Hips", rigged_pose.Hips.rotation, 0.7);
    rig_position(
      "Hips",
      {
        x: rigged_pose.Hips.position.x, // Reverse direction
        y: rigged_pose.Hips.position.y + 1, // Add a bit of height
        z: -rigged_pose.Hips.position.z, // Reverse direction
      },
      1,
      0.07
    );

    rig_rotation("Chest", rigged_pose.Spine, 0.25, 0.3);
    rig_rotation("Spine", rigged_pose.Spine, 0.45, 0.3);

    rig_rotation("RightUpperArm", rigged_pose.RightUpperArm, 1, 0.3);
    rig_rotation("RightLowerArm", rigged_pose.RightLowerArm, 1, 0.3);
    rig_rotation("LeftUpperArm", rigged_pose.LeftUpperArm, 1, 0.3);
    rig_rotation("LeftLowerArm", rigged_pose.LeftLowerArm, 1, 0.3);

    rig_rotation("LeftUpperLeg", rigged_pose.LeftUpperLeg, 1, 0.3);
    rig_rotation("LeftLowerLeg", rigged_pose.LeftLowerLeg, 1, 0.3);
    rig_rotation("RightUpperLeg", rigged_pose.RightUpperLeg, 1, 0.3);
    rig_rotation("RightLowerLeg", rigged_pose.RightLowerLeg, 1, 0.3);
  }

  // Animate Hands
  if (left_hand_landmarks) {
    rigged_left_hand = Kalidokit.Hand.solve(left_hand_landmarks, "Left");
    rig_rotation("LeftHand", {
      // Combine pose rotation Z and hand rotation X Y
      z: rigged_pose.LeftHand.z,
      y: rigged_left_hand.LeftWrist.y,
      x: rigged_left_hand.LeftWrist.x,
    });
    rig_rotation("LeftRingProximal", rigged_left_hand.LeftRingProximal);
    rig_rotation("LeftRingIntermediate", rigged_left_hand.LeftRingIntermediate);
    rig_rotation("LeftRingDistal", rigged_left_hand.LeftRingDistal);
    rig_rotation("LeftIndexProximal", rigged_left_hand.LeftIndexProximal);
    rig_rotation(
      "LeftIndexIntermediate",
      rigged_left_hand.LeftIndexIntermediate
    );
    rig_rotation("LeftIndexDistal", rigged_left_hand.LeftIndexDistal);
    rig_rotation("LeftMiddleProximal", rigged_left_hand.LeftMiddleProximal);
    rig_rotation(
      "LeftMiddleIntermediate",
      rigged_left_hand.LeftMiddleIntermediate
    );
    rig_rotation("LeftMiddleDistal", rigged_left_hand.LeftMiddleDistal);
    rig_rotation("LeftThumbProximal", rigged_left_hand.LeftThumbProximal);
    rig_rotation(
      "LeftThumbIntermediate",
      rigged_left_hand.LeftThumbIntermediate
    );
    rig_rotation("LeftThumbDistal", rigged_left_hand.LeftThumbDistal);
    rig_rotation("LeftLittleProximal", rigged_left_hand.LeftLittleProximal);
    rig_rotation(
      "LeftLittleIntermediate",
      rigged_left_hand.LeftLittleIntermediate
    );
    rig_rotation("LeftLittleDistal", rigged_left_hand.LeftLittleDistal);
  }
  if (right_hand_landmarks) {
    rigged_right_hand = Kalidokit.Hand.solve(right_hand_landmarks, "Right");
    rig_rotation("RightHand", {
      // Combine Z axis from pose hand and X/Y axis from hand wrist rotation
      z: rigged_pose.RightHand.z,
      y: rigged_right_hand.RightWrist.y,
      x: rigged_right_hand.RightWrist.x,
    });
    rig_rotation("RightRingProximal", rigged_right_hand.RightRingProximal);
    rig_rotation(
      "RightRingIntermediate",
      rigged_right_hand.RightRingIntermediate
    );
    rig_rotation("RightRingDistal", rigged_right_hand.RightRingDistal);
    rig_rotation("RightIndexProximal", rigged_right_hand.RightIndexProximal);
    rig_rotation(
      "RightIndexIntermediate",
      rigged_right_hand.RightIndexIntermediate
    );
    rig_rotation("RightIndexDistal", rigged_right_hand.RightIndexDistal);
    rig_rotation("RightMiddleProximal", rigged_right_hand.RightMiddleProximal);
    rig_rotation(
      "RightMiddleIntermediate",
      rigged_right_hand.RightMiddleIntermediate
    );
    rig_rotation("RightMiddleDistal", rigged_right_hand.RightMiddleDistal);
    rig_rotation("RightThumbProximal", rigged_right_hand.RightThumbProximal);
    rig_rotation(
      "RightThumbIntermediate",
      rigged_right_hand.RightThumbIntermediate
    );
    rig_rotation("RightThumbDistal", rigged_right_hand.RightThumbDistal);
    rig_rotation("RightLittleProximal", rigged_right_hand.RightLittleProximal);
    rig_rotation(
      "RightLittleIntermediate",
      rigged_right_hand.RightLittleIntermediate
    );
    rig_rotation("RightLittleDistal", rigged_right_hand.RightLittleDistal);
  }
};

window.addEventListener("pywebviewready", () => {
  open_video_btn.hidden = false;
  open_video_btn.onclick = async () => {
    const video_size = await pywebview.api.get_video_path();
    if (video_size) {
      const [width, height] = video_size;
      initialize(width, height);
      while (true) {
        const results = await pywebview.api.process();
        if (results) {
          background.src = results.image_uri;
          if (results.pose_landmarks) {
            renderer_canvas.hidden = false;
            animate_vrm(current_vrm, results, width, height);
          } else {
            renderer_canvas.hidden = true;
          }
        } else {
          break;
        }
      }
    }
  };
});

const initialize = (width, height) => {
  background.width = width;
  background.height = height;
  renderer_canvas.width = width;
  renderer_canvas.height = height;
  renderer.setSize(renderer_canvas.width, renderer_canvas.height);

  camera.aspect = renderer_canvas.width / renderer_canvas.height;
};
