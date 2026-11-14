/*
 * FALCON node, Build 1, as it stands in the yard (November 2026).
 * A hand-built three.js model drawn from photographs. It is not a CAD file:
 * outside shapes follow the photos, positions inside the box are approximate.
 *
 * Units are millimetres. Y is up. +Z is the front (towards the water bowl).
 * +X is the viewer's right when facing the front.
 * Needs three.js r128 (the copy in this folder). The viewer in falcon-viewer.js draws it.
 *
 * Inside the box:  Raspberry Pi 4 with the audio HAT, the PoE splitter, the rain-sensor chip.
 * Outside the box: camera in a foam frame under a black hood, rain plate on the hood,
 *                  weather sensor below the camera. Every cable leaves from underneath.
 */
function buildFalconNode(THREE) {
  var root = new THREE.Group(); root.name = 'FALCON_node_build1';
  var node = new THREE.Group(); node.name = 'node'; root.add(node);              // everything that leans with the box
  var base = new THREE.Group(); base.name = 'box_base'; node.add(base);
  var inside = new THREE.Group(); inside.name = 'inside'; node.add(inside);
  var lidAsm = new THREE.Group(); lidAsm.name = 'lid_and_camera_head'; node.add(lidAsm);
  var ties = new THREE.Group(); ties.name = 'cloth_ties'; root.add(ties);
  var mount = new THREE.Group(); mount.name = 'post'; root.add(mount);
  var leads = new THREE.Group(); leads.name = 'cables_below'; root.add(leads);
  var scenery = new THREE.Group(); scenery.name = 'scenery'; root.add(scenery);

  function M(color, o) {
    var p = { color: color, roughness: 0.78, metalness: 0.04 };
    if (o) for (var k in o) p[k] = o[k];
    var m = new THREE.MeshStandardMaterial(p); m.color.convertSRGBToLinear(); return m;
  }
  function flat(color, o) {
    var p = { color: color }; if (o) for (var k in o) p[k] = o[k];
    var m = new THREE.MeshBasicMaterial(p); m.color.convertSRGBToLinear(); return m;
  }
  var DS = THREE.DoubleSide;
  var mats = {
    shell: M(0xc3c8c2, { side: DS }), lid: M(0xcdd1cb, { side: DS }), tape: M(0x1b1d1f, { roughness: 0.55 }),
    screw: M(0x9aa0a6, { metalness: 0.8, roughness: 0.3 }), dark: flat(0x0a0b0b, { side: DS }),
    pi: M(0x2e8b57), hat: M(0x2c5fb3), silk: M(0xf2f4f0), port: M(0xb9bec4, { metalness: 0.65, roughness: 0.35 }),
    usb3: M(0x2f6fd0), black: M(0x17191b), pin: M(0xd9b24a, { metalness: 0.7, roughness: 0.35 }),
    splitter: M(0x24272a, { metalness: 0.45, roughness: 0.5 }), chip: M(0x2a63b8), pot: M(0x3f86e0),
    foam: M(0x34363a, { roughness: 1 }), hood: M(0x141516, { roughness: 0.42, metalness: 0.12, side: DS }),
    board: M(0x101112), lens: M(0x0b0c0d, { roughness: 0.3, metalness: 0.5 }), glass: M(0x4a1f22, { roughness: 0.05, metalness: 0.5 }),
    led: M(0xe9e4d2, { metalness: 0.4, roughness: 0.2 }), ldr: M(0x3fae6a), tie: M(0xf1f1ee, { roughness: 0.6 }),
    plate: M(0x6f4c2f), copper: M(0xc67c43, { metalness: 0.7, roughness: 0.35 }), bme: M(0x2f3f96),
    cable: M(0x121314, { roughness: 0.6 }), purple: M(0x7d52a8), grey: M(0x8b9096), yellow: M(0xe0a53a), green: M(0x4d9a5b), red: M(0xc8463c),
    cloth: M(0xf3f1ea, { roughness: 1, side: DS }), rust: M(0x6a4631, { roughness: 0.95 }), stone: M(0x8d8a82, { roughness: 1 }),
    ground: M(0xb9ad95, { roughness: 1, transparent: true, depthWrite: false }), bowl: M(0x9c9a90, { roughness: 0.95 }), water: M(0x58786a, { roughness: 0.15, metalness: 0.2 }),
    cone: flat(0x326f78, { transparent: true, opacity: 0.2, side: DS, depthWrite: false })
  };

  function box(g, w, h, d, m, x, y, z, name) {
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (name) b.name = name; g.add(b); return b;
  }
  function cyl(g, r, len, m, x, y, z, axis, name, seg) {
    var c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 24), m);
    if (axis === 'x') c.rotation.z = Math.PI / 2; if (axis === 'z') c.rotation.x = Math.PI / 2;
    c.position.set(x, y, z); if (name) c.name = name; g.add(c); return c;
  }
  function tube(g, pts, r, m, name) {
    var curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    var t = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, pts.length * 14), r, 8, false), m); if (name) t.name = name; g.add(t); return t;
  }
  function disc(g, r, x, y, z, face, m) {
    var h = new THREE.Mesh(new THREE.CircleGeometry(r, 20), m || mats.dark);
    if (face === 'y') h.rotation.x = Math.PI / 2; if (face === 'x') h.rotation.y = Math.PI / 2;
    h.position.set(x, y, z); g.add(h); return h;
  }
  function rrect(w, h, r) {                                  // rounded rectangle centred on the origin
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  }
  function slab(g, shape, depth, m, x, y, z, name) {         // shape extruded along +Z from z
    var geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 5 });
    var s = new THREE.Mesh(geo, m); s.position.set(x, y, z); if (name) s.name = name; g.add(s); return s;
  }
  function ring(w, h, r, t) { var s = rrect(w, h, r); s.holes.push(rrect(w - 2 * t, h - 2 * t, Math.max(0.5, r - t))); return s; }

  // ---------------------------------------------------------------- enclosure
  // IP65 ABS junction box, 115 wide x 195 tall x 75 deep, standing upright. Base at the back, shallow lid at the front.
  var W = 115, H = 195, ZB = -37.5, ZF = 37.5, ZL = 18.5, T = 2.6, RC = 9, ZW = ZB + T;
  slab(base, rrect(W, H, RC), T, mats.shell, 0, H / 2, ZB, 'back_wall');
  slab(base, ring(W, H, RC, T), ZL - ZB, mats.shell, 0, H / 2, ZB, 'base_walls');
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (c) {                      // corner screw pillars inside the base
    var px = c[0] * (W / 2 - 8), py = H / 2 + c[1] * (H / 2 - 8);
    cyl(base, 5.2, ZL - ZW, mats.shell, px, py, (ZL + ZW) / 2, 'z'); disc(base, 1.7, px, py, ZL + 0.05, 'z');
  });
  slab(lidAsm, rrect(W, H, RC), T, mats.lid, 0, H / 2, ZF - T, 'lid_face');
  slab(lidAsm, ring(W, H, RC, T), ZF - ZL - T, mats.lid, 0, H / 2, ZL, 'lid_walls');
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (c) {                      // lid screws
    var px = c[0] * (W / 2 - 8), py = H / 2 + c[1] * (H / 2 - 8);
    disc(lidAsm, 4.2, px, py, ZF + 0.05, 'z'); cyl(lidAsm, 3, 1.2, mats.screw, px, py, ZF + 0.3, 'z', 'lid_screw');
  });
  slab(lidAsm, ring(W + 1.2, H + 1.2, RC + 0.6, 1.2), 15, mats.tape, 0, H / 2, ZL - 8, 'seam_tape');   // black tape round the lid seam

  // Holes. Underneath: one 25 mm hole that all four cables share, and nine 2 mm holes that let sound and air in.
  var HOLE = { x: -20, z: -10, r: 12.5 };
  disc(base, HOLE.r, HOLE.x, -0.06, HOLE.z, 'y'); disc(base, HOLE.r, HOLE.x, T + 0.06, HOLE.z, 'y');
  var SND = { x: 26, z: -10, pitch: 6 };
  for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) {
    disc(base, 1.1, SND.x + i * SND.pitch, -0.06, SND.z + j * SND.pitch, 'y'); disc(base, 1.1, SND.x + i * SND.pitch, T + 0.06, SND.z + j * SND.pitch, 'y');
  }
  disc(base, 1.5, -W / 2 - 0.06, H - 17, -14, 'x'); disc(base, 1.5, -W / 2 - 0.06, H - 17, -6, 'x');   // two small holes high on the left side

  // ---------------------------------------------------------------- inside the box (fixed to the back wall)
  // Raspberry Pi 4, upright with its USB and Ethernet sockets pointing down, on the right.
  var PX = 23, PYB = 63, PZ = ZW + 6;                         // board centre x, bottom edge y, board plane z
  var PYC = PYB + 42.5;
  box(inside, 56, 85, 1.6, mats.pi, PX, PYC, PZ, 'raspberry_pi_4');
  box(inside, 16, 21, 13.5, mats.port, PX + 18.5, PYB + 7.5, PZ + 7.5, 'pi_ethernet');
  box(inside, 13.2, 17.5, 15.5, mats.port, PX, PYB + 5.8, PZ + 8.5, 'pi_usb3'); box(inside, 11, 1.2, 4.5, mats.usb3, PX, PYB - 2.6, PZ + 12);
  box(inside, 13.2, 17.5, 15.5, mats.port, PX - 18, PYB + 5.8, PZ + 8.5, 'pi_usb2');
  box(inside, 3.2, 9, 3.2, mats.port, PX - 27, PYB + 74, PZ + 2.4, 'pi_usb_c');
  box(inside, 5, 51, 9, mats.black, PX + 24.5, PYB + 52.5, PZ + 5.3, 'gpio_header');
  // Waveshare DA7212 audio HAT on a stacking header: blue board over the upper part of the Pi, two microphones.
  var HZ = PZ + 13;
  box(inside, 56, 65, 1.6, mats.hat, PX, PYB + 52.5, HZ, 'audio_hat_da7212');
  [22, 48].forEach(function (dy) {
    var r = new THREE.Mesh(new THREE.TorusGeometry(11, 0.45, 6, 40), mats.silk); r.position.set(PX - 6, PYB + 20 + dy, HZ + 0.9); inside.add(r);
  });
  box(inside, 3.6, 2.6, 1.1, mats.port, PX - 22, PYB + 26, HZ + 1.3, 'microphone'); box(inside, 3.6, 2.6, 1.1, mats.port, PX - 22, PYB + 80, HZ + 1.3, 'microphone');
  for (var p = 0; p < 20; p++) box(inside, 1.1, 1.1, 7, mats.pin, PX + 24.5, PYB + 28.4 + p * 2.54, HZ + 4, 'header_pin');
  // PoE splitter: black finned block on the left. Power and data come in on one cable; it feeds the Pi.
  var SX = -36, SY = 86;
  box(inside, 30, 100, 22, mats.splitter, SX, SY, ZW + 11, 'poe_splitter');
  for (var f = -3; f <= 3; f++) box(inside, 2.1, 98, 2.4, mats.splitter, SX + f * 3.9, SY, ZW + 23);
  box(inside, 15, 4, 12, mats.port, SX - 5, SY - 51, ZW + 11); box(inside, 15, 4, 12, mats.port, SX + 8, SY - 51, ZW + 11);
  // Rain-sensor chip (LM393 comparator board): small blue board with a trimmer, top left.
  var CX = -30, CY = 166;
  box(inside, 32, 14, 1.6, mats.chip, CX, CY, ZW + 4, 'rain_sensor_chip'); box(inside, 6.5, 6.5, 5, mats.pot, CX + 3, CY, ZW + 7.3);
  box(inside, 2.6, 10, 6, mats.black, CX + 14, CY, ZW + 7.5); box(inside, 2.6, 5, 6, mats.black, CX - 14, CY, ZW + 7.5);

  // Cables inside. All of them come up through the one hole underneath.
  tube(inside, [[HOLE.x - 3, 2, HOLE.z], [HOLE.x - 9, 14, HOLE.z + 1], [SX - 5, 26, ZW + 12], [SX - 5, 34, ZW + 11]], 2.8, mats.cable, 'ethernet_in');
  tube(inside, [[SX + 8, 34, ZW + 11], [SX + 12, 22, ZW + 13], [-2, 14, ZW + 16], [PX + 12, 22, ZW + 16], [PX + 18.5, 44, PZ + 8], [PX + 18.5, PYB - 2, PZ + 7.5]], 2.3, mats.cable, 'splitter_to_pi_ethernet');
  tube(inside, [[SX + 6, SY + 50, ZW + 11], [SX + 8, SY + 62, ZW + 12], [-16, 150, ZW + 10], [PX - 33, PYB + 76, PZ + 3], [PX - 28.5, PYB + 74, PZ + 2.4]], 1.7, mats.cable, 'splitter_usb_c_power');
  tube(inside, [[HOLE.x + 5, 2, HOLE.z + 2], [HOLE.x + 12, 18, HOLE.z + 4], [PX - 18, 34, PZ + 12], [PX - 18, PYB - 3, PZ + 9]], 1.9, mats.cable, 'camera_usb_in');
  box(inside, 12, 14, 6.5, mats.black, PX - 18, PYB - 8, PZ + 9, 'camera_usb_plug');
  tube(inside, [[HOLE.x - 4, 2, HOLE.z - 5], [-50, 16, -24], [-53.2, 70, -29], [-53.2, 140, -29], [CX - 18, CY - 4, ZW + 8], [CX - 14, CY + 1.4, ZW + 9]], 0.8, mats.purple, 'rain_plate_wire_a');
  tube(inside, [[HOLE.x - 2, 2, HOLE.z - 6], [-48, 17, -26], [-51.4, 70, -31], [-51.4, 140, -31], [CX - 18, CY - 6, ZW + 7], [CX - 14, CY - 1.4, ZW + 9]], 0.8, mats.grey, 'rain_plate_wire_b');
  [[mats.red, -3], [mats.cable, 0], [mats.yellow, 3]].forEach(function (w) {        // chip to the Pi: power, ground, signal
    tube(inside, [[CX + 14, CY + w[1], ZW + 10], [CX + 22, CY + 6 + w[1], ZW + 20], [20, 180 + w[1] * 0.6, ZW + 26], [PX + 26, 168, HZ + 16], [PX + 24.5, PYB + 60 + w[1] * 2.54, HZ + 8]], 0.7, w[0], 'rain_chip_to_pi');
  });
  [[mats.yellow, 0], [mats.green, 1.5], [mats.red, 3], [mats.cable, 4.5]].forEach(function (w) {   // weather sensor lead to the Pi
    var o = w[1];
    tube(inside, [[HOLE.x + 3 + o * 0.5, 2, HOLE.z + 6], [-13 + o, 24, ZW + 20], [-13 + o, 120, ZW + 22], [-11 + o, 153 + o, ZW + 24], [PX + 10, 157 + o, HZ + 8], [PX + 33 - o * 0.4, 150, HZ + 12], [PX + 30, PYB + 44 - o * 1.7, HZ + 10], [PX + 24.5, PYB + 44 - o * 1.7, HZ + 8]], 0.65, w[0], 'weather_sensor_lead_in');
  });

  // ---------------------------------------------------------------- camera head on the lid
  // Low on the lid: camera board in a foam frame under a black hood, pointed slightly down at the bowl.
  var cam = new THREE.Group(); cam.name = 'camera_head'; lidAsm.add(cam);
  var CAMY = 30, CAMTILT = 0.16;
  cam.position.set(0, CAMY, ZF); cam.rotation.x = CAMTILT;
  var R = 47, LEN = 86, HY = -12;                             // hood radius, length, and its axis height relative to the lens
  var hood = new THREE.Mesh(new THREE.CylinderGeometry(R, R, LEN, 48, 1, true, Math.PI / 2, Math.PI), mats.hood);
  hood.rotation.x = Math.PI / 2; hood.position.set(0, HY, LEN / 2 - 2); hood.name = 'hood'; cam.add(hood);
  box(cam, 1.2, 12, LEN, mats.hood, -R + 0.4, HY - 6, LEN / 2 - 2, 'hood_side'); box(cam, 1.2, 12, LEN, mats.hood, R - 0.4, HY - 6, LEN / 2 - 2, 'hood_side');
  var rim = new THREE.Mesh(new THREE.TorusGeometry(R, 1.3, 8, 48, Math.PI), mats.tape); rim.position.set(0, HY, LEN - 2); rim.name = 'hood_rim'; cam.add(rim);
  var back = new THREE.Mesh(new THREE.CircleGeometry(R - 0.6, 40, 0, Math.PI), mats.hood); back.position.set(0, HY, 0.8); back.name = 'hood_back'; cam.add(back);
  box(cam, 2 * R - 1.2, 12, 1, mats.hood, 0, HY - 6, 0.8, 'hood_back_lower');
  // Foam frame: two posts and a bottom bar round the camera, with rails back to the lid.
  var BZ = 60;                                                // camera board plane
  box(cam, 16, 70, 24, mats.foam, -27, -17, BZ + 2, 'foam_post'); box(cam, 16, 70, 24, mats.foam, 27, -17, BZ + 2, 'foam_post');
  box(cam, 70, 14, 24, mats.foam, 0, -45, BZ + 2, 'foam_bar');
  box(cam, 16, 44, BZ - 12, mats.foam, -27, -4, (BZ - 10) / 2 - 1, 'foam_rail'); box(cam, 16, 44, BZ - 12, mats.foam, 27, -4, (BZ - 10) / 2 - 1, 'foam_rail');
  // Camera: 38 mm board, M12 lens, six infrared LEDs, light sensor.
  box(cam, 38, 38, 1.6, mats.board, 0, 0, BZ, 'camera_board');
  box(cam, 14, 14, 7, mats.lens, 0, 0, BZ + 4.3, 'lens_holder'); cyl(cam, 7, 11, mats.lens, 0, 0, BZ + 12, 'z', 'm12_lens'); cyl(cam, 5.2, 0.6, mats.glass, 0, 0, BZ + 17.6, 'z', 'lens_glass');
  [-1, 1].forEach(function (sx) { [-9, 0, 9].forEach(function (dy) {
    cyl(cam, 2.5, 6, mats.led, sx * 13.5, dy + 2, BZ + 3.8, 'z', 'infrared_led');
    var tip = new THREE.Mesh(new THREE.SphereGeometry(2.5, 14, 10), mats.led); tip.position.set(sx * 13.5, dy + 2, BZ + 6.8); cam.add(tip);
  }); });
  cyl(cam, 2.6, 1.6, mats.ldr, 5, 15, BZ + 1.6, 'z', 'light_sensor');
  [[-15.5, 15.5], [15.5, 15.5], [-15.5, -15.5], [15.5, -15.5]].forEach(function (c) { cyl(cam, 1.9, 0.3, mats.pin, c[0], c[1], BZ + 0.9, 'z'); });
  // Weather sensor (BME280) just below the camera, tied into the frame.
  var bme = new THREE.Group(); bme.name = 'weather_sensor_bme280'; cam.add(bme);
  box(bme, 20, 26, 1.6, mats.bme, 0, 0, 0, 'bme280_board'); box(bme, 2.6, 2.6, 1.1, mats.port, 4, -5, 1.3, 'bme280_sensor_can');
  for (var q = -2.5; q <= 2.5; q++) box(bme, 1, 5, 1, mats.pin, q * 2.54, 10.5, 2.6);
  bme.position.set(-2, -30, BZ + 3); bme.rotation.x = -0.5;
  [-8, 6].forEach(function (x) { box(cam, 2.3, 34, 1.2, mats.tie, x, -34, BZ + 14.6, 'cable_tie'); box(cam, 2.3, 1.2, 26, mats.tie, x, -52.4, BZ + 2); });
  box(cam, 2.3, 26, 1.2, mats.tie, 6, -64, BZ + 13, 'cable_tie_tail').rotation.z = 0.25;
  // Rain plate on top of the hood, leaning back against the lid, copper side up.
  var rain = new THREE.Group(); rain.name = 'rain_plate'; cam.add(rain);
  box(rain, 54, 1.6, 40, mats.plate, 0, 0, 0, 'rain_plate_board');
  box(rain, 50, 0.35, 1.5, mats.copper, 0, 1, -17.5); box(rain, 50, 0.35, 1.5, mats.copper, 0, 1, 17.5);
  for (var c = -11; c <= 11; c++) box(rain, 1.25, 0.35, 31, mats.copper, c * 2.1, 1, c % 2 ? 2.2 : -2.2);
  box(rain, 2.6, 6, 5.2, mats.black, -28, 1.6, 0, 'rain_plate_pins');
  rain.position.set(0, HY + R + 15.5, 15.5); rain.rotation.x = Math.PI / 4 - CAMTILT;
  // Wires that start at the head. They run down behind the hood and go in underneath the box.
  function fromCam(x, y, z) { cam.updateMatrix(); var v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrix); return [v.x, v.y, v.z]; }
  var plateL = fromCam(-30, HY + R + 17, 15.5);
  tube(lidAsm, [plateL, [-50, 84, ZF + 8], [-60.5, 60, ZF - 6], [-61.5, 26, 14], [-52, 4, 6], [-36, -9, -2], [HOLE.x - 4, -6, HOLE.z - 5], [HOLE.x - 4, 1, HOLE.z - 5]], 0.8, mats.purple, 'rain_plate_wire_a');
  tube(lidAsm, [[plateL[0], plateL[1] - 2.5, plateL[2] + 1], [-51, 80, ZF + 9], [-62.5, 58, ZF - 5], [-63.5, 26, 12], [-54, 2, 5], [-37, -11, -3], [HOLE.x - 2, -7, HOLE.z - 6], [HOLE.x - 2, 1, HOLE.z - 6]], 0.8, mats.grey, 'rain_plate_wire_b');
  tube(lidAsm, [fromCam(0, -4, BZ - 3), fromCam(-6, -26, BZ - 22), fromCam(-10, -40, 22), [-12, -16, 20], [-16, -17, 2], [HOLE.x + 5, -9, HOLE.z + 2], [HOLE.x + 5, 1, HOLE.z + 2]], 1.9, mats.cable, 'camera_usb_cable');
  [[mats.yellow, 0], [mats.green, 1.6], [mats.red, 3.2], [mats.cable, 4.8]].forEach(function (w) {
    tube(lidAsm, [fromCam(-6 + w[1], -40, BZ - 1), fromCam(-4 + w[1], -44, BZ - 20), fromCam(-2 + w[1], -42, 18), [-4 + w[1], -20, 14], [-10 + w[1], -19, 0], [HOLE.x + 2 + w[1] * 0.4, -8, HOLE.z + 6], [HOLE.x + 2 + w[1] * 0.4, 1, HOLE.z + 6]], 0.65, w[0], 'weather_sensor_lead');
  });

  // ---------------------------------------------------------------- how it is fixed: cloth ties to a post, a stone wedge behind the top
  var LEAN = 0.10;                                            // the wedge tips the whole box forward a little
  node.rotation.x = LEAN; node.position.set(0, ZB * Math.sin(LEAN), ZB * (1 - Math.cos(LEAN)));
  function fromNode(x, y, z) { node.updateMatrix(); var v = new THREE.Vector3(x, y, z).applyMatrix4(node.matrix); return [v.x, v.y, v.z]; }
  var GROUND = -150;                                          // the box hangs about 15 cm above the ground
  var POST = { x: -12, w: 30, d: 26, top: 400 };
  var postZ = ZB - 1 - POST.d / 2;
  box(mount, POST.w, POST.top - GROUND, POST.d, mats.rust, POST.x, (POST.top + GROUND) / 2, postZ, 'post');
  var stone = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), mats.stone); stone.scale.set(1.5, 0.8, 0.62); stone.rotation.set(0.3, 0.5, 0.1);
  stone.position.set(POST.x + 6, 168, ZB + 5); stone.name = 'stone_wedge'; mount.add(stone);
  // A tie is a flat band through a loop of points: round the box, then in to the post and round its back.
  function strip(g, a, b, wide, thick, m) {
    var va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]), len = va.distanceTo(vb);
    var s = new THREE.Mesh(new THREE.BoxGeometry(len + thick, wide, thick), m);
    s.position.copy(va).add(vb).multiplyScalar(0.5); s.rotation.order = 'YZX';
    s.rotation.y = -Math.atan2(vb.z - va.z, vb.x - va.x); s.rotation.z = Math.asin((vb.y - va.y) / len); g.add(s); return s;
  }
  function tie(yFront, yBack, name) {
    var g = new THREE.Group(); g.name = name; ties.add(g);
    var gap = 1.4, pb = postZ - POST.d / 2 - gap, pl = POST.x - POST.w / 2 - gap, pr = POST.x + POST.w / 2 + gap;
    var fl = fromNode(-W / 2 - gap, yFront, ZF + gap), fr = fromNode(W / 2 + gap, yFront, ZF + gap);
    var bl = fromNode(-W / 2 - gap, yBack, ZB - gap), br = fromNode(W / 2 + gap, yBack, ZB - gap);
    var loop = [fl, fr, br, [pr, br[1], pb], [pl, bl[1], pb], bl];
    for (var n = 0; n < loop.length; n++) strip(g, loop[n], loop[(n + 1) % loop.length], 12, 1.5, mats.cloth);
    return { fl: fl, fr: fr };
  }
  var upper = tie(128, 132, 'cloth_tie_upper'); tie(106, 150, 'cloth_tie_lower');
  var kx = 14, ky = upper.fl[1], kz = upper.fl[2] + 4;
  var knot = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), mats.cloth); knot.scale.set(1.3, 0.95, 0.7); knot.position.set(kx, ky, kz); knot.name = 'knot'; ties.add(knot);
  strip(ties, [kx + 2, ky - 2, kz - 1], [kx + 16, ky - 30, kz - 2], 9, 1.4, mats.cloth).name = 'tie_tail';

  // ---------------------------------------------------------------- one Ethernet cable away to the house (power and data)
  var e0 = fromNode(HOLE.x - 3, 1, HOLE.z), e1 = fromNode(HOLE.x - 3, -22, HOLE.z);
  tube(leads, [e0, e1, [e1[0] + 3, -84, e1[2] - 3], [e1[0] + 16, GROUND + 26, e1[2] + 8], [e1[0] + 60, GROUND + 4, e1[2] + 44], [e1[0] + 135, GROUND + 3, e1[2] + 62], [e1[0] + 215, GROUND + 3, e1[2] + 30], [e1[0] + 262, GROUND + 3, e1[2] - 30], [e1[0] + 290, GROUND + 3, e1[2] - 110]], 3, mats.cable, 'ethernet_cable_to_house');

  // ---------------------------------------------------------------- the place: ground, post foot, water bowl about a metre in front
  var pad = new THREE.Mesh(new THREE.CircleGeometry(360, 56), mats.ground); pad.rotation.x = -Math.PI / 2; pad.position.set(30, GROUND, 30); pad.name = 'ground_patch'; pad.renderOrder = 1; root.add(pad);
  if (typeof document !== 'undefined') {                      // fade the patch out towards its edge
    var cv = document.createElement('canvas'); cv.width = cv.height = 128; var cx = cv.getContext('2d');
    var gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.62, '#fff'); gr.addColorStop(1, '#000');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128); mats.ground.alphaMap = new THREE.CanvasTexture(cv);
  }
  var far = new THREE.Mesh(new THREE.CircleGeometry(1500, 72), mats.ground); far.rotation.x = -Math.PI / 2; far.position.set(0, GROUND - 0.5, 520); far.name = 'ground'; far.renderOrder = 1; scenery.add(far);
  var BOWL = { z: 1000, r: 250 };
  var dish = new THREE.Mesh(new THREE.CylinderGeometry(BOWL.r, BOWL.r - 40, 60, 48), mats.bowl); dish.position.set(0, GROUND + 30, BOWL.z); dish.name = 'water_bowl'; scenery.add(dish);
  var water = new THREE.Mesh(new THREE.CircleGeometry(BOWL.r - 22, 48), mats.water); water.rotation.x = -Math.PI / 2; water.position.set(0, GROUND + 60.6, BOWL.z); water.name = 'water'; scenery.add(water);
  // What the camera looks at: a soft fan on the ground from under the lens out past the bowl. A sketch, not a measured field of view.
  cam.updateMatrix(); node.updateMatrix();
  var lensM = new THREE.Matrix4().multiplyMatrices(node.matrix, cam.matrix);
  var lens0 = new THREE.Vector3(0, 0, BZ + 18).applyMatrix4(lensM);
  var FAN = { reach: 1420, half: 0.62 };
  var fan = new THREE.Mesh(new THREE.CircleGeometry(FAN.reach, 40, Math.PI / 2 - FAN.half, 2 * FAN.half), mats.cone);
  fan.rotation.x = -Math.PI / 2; fan.rotation.z = Math.PI; fan.position.set(lens0.x, GROUND + 1, lens0.z); fan.name = 'camera_view'; fan.renderOrder = 3; scenery.add(fan);
  var sight = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lens0, new THREE.Vector3(0, GROUND + 62, BOWL.z)]), new THREE.LineDashedMaterial({ color: 0x326f78, dashSize: 26, gapSize: 18 }));
  sight.computeLineDistances(); sight.name = 'line_of_sight'; scenery.add(sight);
  scenery.visible = false;

  // The lid, camera head and ties fade away together in the inside view, so they get their own materials.
  var faders = [];
  [lidAsm, ties].forEach(function (g) {
    var own = {};
    g.traverse(function (o) { if (!o.isMesh) return; var k = o.material.uuid; if (!own[k]) { own[k] = o.material.clone(); faders.push(own[k]); } o.material = own[k]; });
  });

  // ---------------------------------------------------------------- views and callouts
  // A view is a camera pose (orbit round `t`: `th` round the vertical axis, `ph` down from straight above, `d` distance)
  // for a wide 4:3 stage and for a tall 4:5 stage on phones. `mode` says what is shown:
  // 'outside' the whole node, 'inside' the box with its lid and camera head taken away, 'place' the node with the bowl.
  // A callout is a point on a part (`at`, in root coordinates) and where its number sits on the stage
  // in the default pose (`wide` and `tall`, in percent of the stage from the top left).
  function nodePt(x, y, z) { return fromNode(x, y, z); }
  function camPt(x, y, z) { var v = new THREE.Vector3(x, y, z).applyMatrix4(lensM); return [v.x, v.y, v.z]; }
  var views = {
    outside: { mode: 'outside', wide: { t: [14, 30, 12], th: 0.52, ph: 1.24, d: 830 }, tall: { t: [8, 26, 12], th: 0.5, ph: 1.24, d: 900 } },
    camera: { mode: 'outside', wide: { t: [0, 28, 86], th: 0.2, ph: 1.68, d: 400 }, tall: { t: [0, 30, 86], th: 0.16, ph: 1.68, d: 460 } },
    under: { mode: 'outside', wide: { t: [22, 0, 22], th: 0.5, ph: 2.7, d: 520 }, tall: { t: [10, 0, 22], th: 0.46, ph: 2.7, d: 600 } },
    inside: { mode: 'inside', wide: { t: [0, 96, -20], th: 0.2, ph: 1.36, d: 600 }, tall: { t: [0, 96, -20], th: 0.18, ph: 1.36, d: 640 } },
    place: { mode: 'place', wide: { t: [0, -70, 500], th: -1.0, ph: 1.12, d: 2400 }, tall: { t: [10, -40, 520], th: -0.22, ph: 0.98, d: 2900 } }
  };
  var callouts = {
    outside: [
      { id: 'box', at: nodePt(40, 178, ZF), wide: [80, 14], tall: [84, 12] },
      { id: 'ties', at: nodePt(-57.5, 118, 6), wide: [22, 30], tall: [14, 30] },
      { id: 'rain', at: camPt(10, HY + R + 18, 14), wide: [80, 40], tall: [86, 40] },
      { id: 'hood', at: camPt(28, HY + R * 0.8, LEN - 16), wide: [80, 56], tall: [86, 55] },
      { id: 'cable', at: [e1[0] + 62, GROUND + 6, e1[2] + 46], wide: [77, 84], tall: [80, 88] }
    ],
    camera: [
      { id: 'rain', at: camPt(18, HY + R + 16, 20), wide: [82, 14], tall: [86, 16] },
      { id: 'hood', at: camPt(38, HY + R * 0.55, LEN - 6), wide: [86, 36], tall: [90, 36] },
      { id: 'lens', at: camPt(0, 0, BZ + 18), wide: [16, 44], tall: [10, 44] },
      { id: 'leds', at: camPt(13.5, -7, BZ + 7), wide: [84, 58], tall: [90, 56] },
      { id: 'light', at: camPt(5, 15, BZ + 2.6), wide: [16, 26], tall: [10, 28] },
      { id: 'foam', at: camPt(-27, -24, BZ + 14), wide: [14, 66], tall: [9, 64] },
      { id: 'weather', at: camPt(-2, -31, BZ + 5), wide: [82, 78], tall: [88, 76] }
    ],
    under: [
      { id: 'hole', at: nodePt(HOLE.x - 8, -0.5, HOLE.z + 5), wide: [18, 54], tall: [10, 52] },
      { id: 'leads', at: camPt(-3, -43, 26), wide: [20, 30], tall: [12, 30] },
      { id: 'sound', at: nodePt(SND.x, -0.5, SND.z), wide: [84, 44], tall: [90, 42] },
      { id: 'cable', at: [e1[0] + 60, GROUND + 4, e1[2] + 44], wide: [86, 74], tall: [88, 72] }
    ],
    inside: [
      { id: 'chip', at: nodePt(CX + 3, CY, ZW + 8), wide: [18, 20], tall: [12, 22] },
      { id: 'splitter', at: nodePt(SX - 4, SY + 16, ZW + 24), wide: [16, 50], tall: [9, 50] },
      { id: 'hat', at: nodePt(PX + 14, PYB + 78, HZ + 1), wide: [84, 28], tall: [91, 30] },
      { id: 'pi', at: nodePt(PX + 18.5, PYB + 6, PZ + 15), wide: [84, 62], tall: [91, 60] },
      { id: 'hole', at: nodePt(HOLE.x - 6, T + 0.5, HOLE.z + 2), wide: [18, 82], tall: [11, 81] },
      { id: 'sound', at: nodePt(SND.x + 4, T + 0.5, SND.z), wide: [82, 85], tall: [89, 84] }
    ],
    place: [
      { id: 'node', at: fromNode(30, 150, ZF), wide: [20, 14], tall: [20, 18] },
      { id: 'sight', at: [lens0.x * 0.5, (lens0.y + GROUND + 62) / 2, (lens0.z + BOWL.z) / 2], wide: [50, 22], tall: [16, 50] },
      { id: 'bowl', at: [BOWL.r * 0.55, GROUND + 62, BOWL.z - 40], wide: [84, 40], tall: [84, 52] },
      { id: 'cable', at: [e1[0] + 215, GROUND + 3, e1[2] + 30], wide: [12, 52], tall: [82, 24] }
    ]
  };
  return { root: root, node: node, base: base, inside: inside, lidAsm: lidAsm, ties: ties, mount: mount, leads: leads, scenery: scenery, pad: pad,
    faders: faders, mats: mats, views: views, callouts: callouts };
}
if (typeof module !== 'undefined') module.exports = { buildFalconNode: buildFalconNode };
