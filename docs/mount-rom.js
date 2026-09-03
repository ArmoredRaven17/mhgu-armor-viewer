// MHGU weapon attachment, reproduced from the game executable. ROM only.
//
// chain:  weapon class -> CLASS_TYPE[class] -> type -> TYPE_INDEX[type][index] -> pos + rot
//         joint = jointFor(index, type)   (player-skeleton gid)
//         rotation is DEGREES, applied in Euler order ZYX (order 0, the uCoord default the parts reset keeps; 0x003070f8 calls the builder with 0)
//
// class->type table  .rodata 0x01621bb8   (25 = no part)
// transforms         get(type,index) at .text 0x00307b74; 48-byte records,
//                    pos (model units, cm) @+0, rot (degrees) @+16
// joint              computeJoint at .text 0x00307d04
//                      index 0,6,8,10        -> 12  Bone_Hand_R
//                      index 1,3,5,7,9,11,14 ->  8  Bone_Hand_L
//                      index 4 -> 11 ; index 20 -> 2 ; index 2 -> the rest mask
//                      rest mask 0x00630802: types 1,11,16,17,21,22 -> 1 (waist)
//                                            type 15 -> 0 (pelvis); else 2 (chest)
window.MHGU_MOUNT = {
  HAND_R: [0,6,8,10],
  HAND_L: [1,3,5,7,9,11,14],
  REST_MASK: 0x00630802,
  ORDER: 'YXZ',
  // Indices the ROM sets as CONSTANTS in the dispatcher's (type-2) jump table at
  // .text 0x00307144 -- not state-dependent, so they are exact.
  //   type 2/5/13 (the Sword&Shield, Lance and Gunlance shields) -> index 4 -> joint 11
  //   type 10/15 arrive with r6 already 2 (set at 0x00307138)
  TYPE_INDEX_FIXED: { 2:4, 5:4, 13:4, 10:2, 15:2 },
  CLASS_TYPE: {
    'w00': {name:'Great Sword',           main: 0, second:null},
    'w01': {name:'Sword & Shield',        main: 1, second:2},
    'w02': {name:'Hammer',                main: 3, second:null},
    'w03': {name:'Lance',                 main: 4, second:5},
    'w04': {name:'Heavy Bowgun',          main: 6, second:null},
    'w05': {name:'Med. Bowgun (Removed)', main: 6, second:null},
    'w06': {name:'Light Bowgun',          main: 6, second:null},
    'w07': {name:'Long Sword',            main: 9, second:10},
    'w08': {name:'Switch Axe',            main:11, second:null},
    'w09': {name:'Gunlance',              main:12, second:13},
    'w10': {name:'Bow',                   main:14, second:15},
    'w11': {name:'Dual Blades',           main:16, second:17},
    'w12': {name:'Hunting Horn',          main:18, second:null},
    'w13': {name:'Insect Glaive',         main:19, second:20},
    'w14': {name:'Charge Blade',          main:21, second:22},
  },
  TYPE_INDEX: {
     0: {1:{pos:[10,0,58],rot:[0,0,180]}, 3:{pos:[10,-2,8],rot:[0,0,180]}, 18:{pos:[-47,51,-24],rot:[89,-4,41]}, 19:{pos:[-11,-2,10],rot:[0,0,0]}},
     1: {2:{pos:[7.9,-0.7,6],rot:[0,0,0]}, 17:{pos:[32.6,-1.2,-17.5],rot:[97,4,-84]}},
     3: {1:{pos:[62,8,-17],rot:[-98,10,110]}, 2:{pos:[8,-2.8,4],rot:[0,0,0]}, 17:{pos:[62,8,-17],rot:[-98,10,110]}},
     4: {2:{pos:[7.8,-1.8,-0.6],rot:[0,0,0]}, 17:{pos:[-1.2,-24,-20],rot:[-0.7,-98.3,-89.7]}},
     9: {1:{pos:[10,0,58],rot:[0,0,180]}, 3:{pos:[10,-2,8],rot:[0,0,180]}, 18:{pos:[-47,51,-24],rot:[89,-4,41]}, 19:{pos:[-11,-2,10],rot:[0,0,0]}},
    11: {1:{pos:[10,-1,65],rot:[0,0,180]}, 3:{pos:[10,-2,8],rot:[0,10,180]}, 6:{pos:[-23,6,21],rot:[-0.5,-38,-27]}, 18:{pos:[-38,-22,-25],rot:[92,-4,122]}},
    12: {2:{pos:[7.8,-1.8,-0.6],rot:[0,0,0]}, 17:{pos:[13,8,-22],rot:[30,91,120]}},
    14: {2:{pos:[10,-1,1],rot:[80,0,160]}, 17:{pos:[13,15,-24],rot:[-90,-114,58]}, 18:{pos:[7,-40,-45],rot:[-144,-10,8]}},
    16: {2:{pos:[7.9,-0.7,-6],rot:[0,0,0]}, 17:{pos:[32,37,-16],rot:[-92,-11,126]}},
    18: {1:{pos:[7,-6.7,10],rot:[0,0,0]}, 3:{pos:[7,-6.7,10],rot:[0,0,0]}, 18:{pos:[-2,-60,-21],rot:[-90,180,0]}},
    19: {1:{pos:[8.8,-2,0],rot:[-1.7,-24.5,-176]}, 3:{pos:[8.8,-2,0],rot:[-4,-4,-177]}, 5:{pos:[17,-2,17],rot:[25,2,85]}, 6:{pos:[17,21,86],rot:[-18,11.6,-18]}, 7:{pos:[28,-2,41],rot:[-1.7,-24.5,-176]}, 8:{pos:[-20,2,29],rot:[20,-8,-89]}, 9:{pos:[8.8,-2,0],rot:[178.3,-24.5,-176]}, 11:{pos:[-20,-1,-64],rot:[-1.7,-24.5,-176]}, 18:{pos:[2,10,-20],rot:[-90,-90,27]}},
    21: {1:{pos:[7.9,-0.7,-2],rot:[0,0,180]}, 2:{pos:[0,53.7,-21],rot:[93,0,0]}, 3:{pos:[7.9,-0.7,-6],rot:[0,0,180]}, 5:{pos:[7.9,-0.7,-2],rot:[0,0,180]}, 6:{pos:[-9.2,-0.2,2.4],rot:[-1.6,0.6,-43.3]}, 7:{pos:[7.9,-0.7,56],rot:[0,0,180]}, 14:{pos:[7.9,-0.7,56],rot:[0,0,180]}, 18:{pos:[0,53.7,-21],rot:[93,0,0]}, 21:{pos:[-18.5,12.5,-10],rot:[14,3,-176]}, 22:{pos:[7.9,-0.7,-6],rot:[0,0,180]}, 23:{pos:[0,-3,-33],rot:[87,0,180]}},
    22: {0:{pos:[-18.5,12.5,-10],rot:[14,3,-176]}, 1:{pos:[7.9,-0.7,-6],rot:[0,0,180]}, 2:{pos:[0,-3,-33],rot:[87,0,180]}, 4:{pos:[-18.5,12.5,-10],rot:[14,3,-176]}, 5:{pos:[7.9,-0.7,-2],rot:[0,0,180]}, 6:{pos:[-9.2,-0.2,2.4],rot:[-1.6,0.6,-43.3]}, 7:{pos:[7.9,-0.7,56],rot:[0,0,180]}, 14:{pos:[7.9,-0.7,56],rot:[0,0,180]}, 18:{pos:[0,-3,-33],rot:[87,0,180]}},
  },
};
