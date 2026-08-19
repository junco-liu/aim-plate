/* ── the Robot class ──────────────────────────────────────────────────────────
   The Python API users write, kept name-for-name with the official vex library
   (AIM_Websocket_Library/vex): same method names, same argument order, same units,
   same defaults. A program written against the official docs should run here
   unchanged, so this file is a port and not a design — where the official code does
   something surprising (Led.on maps int 1 to light2; move_at does not clamp negative
   velocity because the firmware flips it) the surprise is reproduced on purpose.

   It lives in a .js file rather than a .py one because a .py would have to be
   fetch()ed, and fetch from file:// is CORS-blocked — that would cost the
   "download and open locally" path this project keeps for Firefox and Safari.

   Three JS bridges are all it talks to, all defined in python.js:
     aimCmd(json)  one ws_cmd round trip, strictly request/response
     aimSleep(sec) a delay that yields to the event loop and honours 停止
     aimStatus()   the newest ws_status packet, plus a _seq counter
   ────────────────────────────────────────────────────────────────────────── */

const AIM_PY = String.raw`
import json, math, time
import js
from enum import Enum
from pyodide.ffi import run_sync

DRIVE_VELOCITY_MAX_MMPS = 200
TURN_VELOCITY_MAX_DPS   = 180

SYS_FLAGS_SOUND_PLAYING  = 1 << 0
SYS_FLAGS_IS_MOVE_ACTIVE = 1 << 1
SYS_FLAGS_IMU_CAL        = 1 << 3
SYS_FLAGS_IS_TURN_ACTIVE = 1 << 4
SYS_FLAGS_IS_MOVING      = 1 << 5
SYS_FLAGS_HAS_CRASHED    = 1 << 6
SYS_FLAGS_IS_SOUND_DNL   = 1 << 16

BARREL_MIN_Y, BARREL_MIN_CX, BARREL_MAX_CX = 160, 120, 200
BALL_MIN_Y,   BALL_MIN_CX,   BALL_MAX_CX   = 170, 120, 200

MOVE_ACTIVE_CMDS = ('drive', 'drive_for')
TURN_ACTIVE_CMDS = ('turn', 'turn_for', 'turn_to')
MOVING_CMDS      = MOVE_ACTIVE_CMDS + TURN_ACTIVE_CMDS

STOP_MARK = '__aim_stop__'


class AimException(Exception):
    pass


class DisconnectedException(AimException):
    pass


# ── types ────────────────────────────────────────────────────────────────────
class PercentUnits(Enum):
    PERCENT = 0

class DriveVelocityUnits(Enum):
    PERCENT = 0
    MMPS = 1

class TurnVelocityUnits(Enum):
    PERCENT = 0
    DPS = 1

class RotationUnits(Enum):
    DEG = 0
    REV = 1
    RAW = 99

class TimeUnits(Enum):
    SECONDS = 0
    MSEC = 1

class DistanceUnits(Enum):
    MM = 0
    IN = 1
    CM = 2

class TurnType(Enum):
    LEFT = 0
    RIGHT = 1

class AxisType(Enum):
    X_AXIS = 0
    Y_AXIS = 1
    Z_AXIS = 2

class OrientationType(Enum):
    ROLL = 0
    PITCH = 1
    YAW = 2

class AccelerationType(Enum):
    FORWARD = 0
    RIGHTWARD = 1
    DOWNWARD = 2

class SensitivityType(Enum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2

class KickType(str, Enum):
    SOFT = 'kick_soft'
    MEDIUM = 'kick_medium'
    HARD = 'kick_hard'

class LightType(str, Enum):
    LED1 = 'light1'
    LED2 = 'light2'
    LED3 = 'light3'
    LED4 = 'light4'
    LED5 = 'light5'
    LED6 = 'light6'
    ALL_LEDS = 'all'

class FontType(str, Enum):
    MONO12 = 'MONO12'
    MONO15 = 'MONO15'
    MONO20 = 'MONO20'
    MONO24 = 'MONO24'
    MONO30 = 'MONO30'
    MONO36 = 'MONO36'
    MONO40 = 'MONO40'
    MONO60 = 'MONO60'
    PROP20 = 'PROP20'
    PROP24 = 'PROP24'
    PROP30 = 'PROP30'
    PROP36 = 'PROP36'
    PROP40 = 'PROP40'
    PROP60 = 'PROP60'

class SoundType(str, Enum):
    DOORBELL = 'DOORBELL'
    TADA = 'TADA'
    FAIL = 'FAIL'
    SPARKLE = 'SPARKLE'
    FLOURISH = 'FLOURISH'
    FORWARD = 'FORWARD'
    REVERSE = 'REVERSE'
    RIGHT = 'RIGHT'
    LEFT = 'LEFT'
    BLINKER = 'BLINKER'
    CRASH = 'CRASH'
    BRAKES = 'BRAKES'
    HUAH = 'HUAH'
    PICKUP = 'PICKUP'
    CHEER = 'CHEER'
    SENSING = 'SENSING'
    DETECTED = 'DETECTED'
    OBSTACLE = 'OBSTACLE'
    LOOPING = 'LOOPING'
    COMPLETE = 'COMPLETE'
    PAUSE = 'PAUSE'
    RESUME = 'RESUME'
    SEND = 'SEND'
    RECEIVE = 'RECEIVE'
    ACT_HAPPY = 'ACT_HAPPY'
    ACT_SAD = 'ACT_SAD'
    ACT_EXCITED = 'ACT_EXCITED'
    ACT_ANGRY = 'ACT_ANGRY'
    ACT_SILLY = 'ACT_SILLY'

EMOJI_NAMES = (
    'EXCITED', 'CONFIDENT', 'SILLY', 'AMAZED', 'STRONG', 'THRILLED', 'HAPPY',
    'PROUD', 'LAUGHING', 'OPTIMISTIC', 'DETERMINED', 'AFFECTIONATE', 'CALM',
    'QUIET', 'SHY', 'CHEERFUL', 'LOVED', 'SURPRISED', 'THINKING', 'TIRED',
    'CONFUSED', 'BORED', 'EMBARRASSED', 'WORRIED', 'SAD', 'SICK',
    'DISAPPOINTED', 'NERVOUS', 'ANNOYED', 'STRESSED', 'ANGRY', 'FRUSTRATED',
    'JEALOUS', 'SHOCKED', 'FEAR', 'DISGUST')

EmojiType = Enum('EmojiType', [(n, i) for i, n in enumerate(EMOJI_NAMES)])

class EmojiLookType(Enum):
    LOOK_FORWARD = 0
    LOOK_LEFT = 1
    LOOK_RIGHT = 2


class DefinedColor:
    def __init__(self, value, transparent=False):
        self.value = value
        self.transparent = transparent

class Color:
    DefinedColor = DefinedColor
    BLACK       = DefinedColor(0x000000)
    WHITE       = DefinedColor(0xFFFFFF)
    RED         = DefinedColor(0xFF0000)
    GREEN       = DefinedColor(0x00FF00)
    BLUE        = DefinedColor(0x001871)
    YELLOW      = DefinedColor(0xFFFF00)
    ORANGE      = DefinedColor(0xFF8500)
    PURPLE      = DefinedColor(0xFF00FF)
    CYAN        = DefinedColor(0x00FFFF)
    TRANSPARENT = DefinedColor(0x000000, True)


VisionObject = Enum('VisionObject',
    [('ALL_VISION', 100), ('ALL_COLORS', 101), ('ALL_CODES', 102), ('ALL_TAGS', 103),
     ('ALL_AIOBJS', 104), ('ALL_CARGO', 105), ('SPORTS_BALL', 200),
     ('BLUE_BARREL', 201), ('ORANGE_BARREL', 202), ('AIM_ROBOT', 203)] +
    [('TAG' + str(i), 300 + i) for i in range(38)])

AI_CLASSNAME = {VisionObject.SPORTS_BALL: 'SportsBall',
                VisionObject.BLUE_BARREL: 'BlueBarrel',
                VisionObject.ORANGE_BARREL: 'OrangeBarrel',
                VisionObject.AIM_ROBOT: 'Robot'}


# ── globals, the names the official examples use bare ────────────────────────
PERCENT = PercentUnits.PERCENT
MMPS = DriveVelocityUnits.MMPS
DPS = TurnVelocityUnits.DPS
DEGREES = RotationUnits.DEG
SECONDS = TimeUnits.SECONDS
MSEC = TimeUnits.MSEC
MM = DistanceUnits.MM
LEFT = TurnType.LEFT
RIGHT = TurnType.RIGHT

SOFT, MEDIUM, HARD = KickType.SOFT, KickType.MEDIUM, KickType.HARD
X_AXIS, Y_AXIS, Z_AXIS = AxisType.X_AXIS, AxisType.Y_AXIS, AxisType.Z_AXIS
ROLL, PITCH, YAW = OrientationType.ROLL, OrientationType.PITCH, OrientationType.YAW
FORWARD = AccelerationType.FORWARD
RIGHTWARD = AccelerationType.RIGHTWARD
DOWNWARD = AccelerationType.DOWNWARD

LED1, LED2, LED3 = LightType.LED1, LightType.LED2, LightType.LED3
LED4, LED5, LED6 = LightType.LED4, LightType.LED5, LightType.LED6
ALL_LEDS = LightType.ALL_LEDS

BLACK, WHITE, RED, GREEN = Color.BLACK, Color.WHITE, Color.RED, Color.GREEN
BLUE, YELLOW, ORANGE = Color.BLUE, Color.YELLOW, Color.ORANGE
PURPLE, CYAN, TRANSPARENT = Color.PURPLE, Color.CYAN, Color.TRANSPARENT

for _n in EMOJI_NAMES:
    globals()[_n] = EmojiType[_n]
LOOK_FORWARD = EmojiLookType.LOOK_FORWARD
LOOK_LEFT = EmojiLookType.LOOK_LEFT
LOOK_RIGHT = EmojiLookType.LOOK_RIGHT

for _f in FontType:
    globals()[_f.name] = _f

# SoundType.FORWARD / REVERSE / LEFT / RIGHT would shadow AccelerationType.FORWARD and
# TurnType.LEFT / RIGHT, so the official library renames exactly those four and skips
# their bare names. Same here.
for _s in SoundType:
    if _s.name not in ('FORWARD', 'REVERSE', 'LEFT', 'RIGHT'):
        globals()[_s.name] = _s
MOVE_FORWARD, MOVE_REVERSE = SoundType.FORWARD, SoundType.REVERSE
TURN_RIGHT, TURN_LEFT = SoundType.RIGHT, SoundType.LEFT

for _v in VisionObject:
    globals()[_v.name] = _v


# ── unit conversion, upper clamp only — negatives are the firmware's job ─────
def _drive_velocity(velocity, units):
    if getattr(units, 'value', 0) == DriveVelocityUnits.MMPS.value:
        return int(min(velocity, DRIVE_VELOCITY_MAX_MMPS))
    return int(min(velocity, 100) * 2)


def _turn_velocity(velocity, units):
    if getattr(units, 'value', 0) == TurnVelocityUnits.DPS.value:
        return int(min(velocity, TURN_VELOCITY_MAX_DPS))
    return int(min(velocity, 100) * 1.8)


def _rgb(color):
    if isinstance(color, DefinedColor):
        value = color.value
    elif isinstance(color, int):
        value = color
    else:
        raise AimException('parameter must be a Color instance or int rgb value')
    return (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF


def _transparent(color):
    return color.transparent if isinstance(color, DefinedColor) else False


class Robot:
    """AIM Robot. Host and sockets belong to the page; Robot() just binds to them."""

    def __init__(self, host=''):
        self.host = host
        self.drive_speed = 100   # official default: 50% == 100 mm/s
        self.turn_speed = 75     # official default: 50% == 75 deg/s
        # The official library ORs a motion flag into the next status packet it
        # receives, because the robot has not caught up when the reply lands.
        # Same effect here, expressed as "treat as active until packet N".
        self._move_until = -1
        self._turn_until = -1
        self._moving_until = -1
        self._stopped_until = -1
        self._imu_cal_until = -1
        self.inertial = Inertial(self)
        self.screen = Screen(self)
        self.kicker = Kicker(self)
        self.sound = Sound(self)
        self.led = Led(self)
        self.vision = AiVision(self)

    # ── plumbing ─────────────────────────────────────────────────────────────
    @property
    def status(self):
        """the newest ws_status packet"""
        raw = js.aimStatus()
        # JS null arrives as JsNull, not None, so test the type rather than identity —
        # otherwise the miss surfaces as a json TypeError instead of this message
        if not isinstance(raw, str):
            raise DisconnectedException(
                '还没有状态包 —— 机器人未连接，或 ws_status 还没回过一包')
        return json.loads(raw)

    def _seq(self):
        raw = js.aimStatus()
        return json.loads(raw)['_seq'] if isinstance(raw, str) else -1

    def _flags(self):
        return int(self.status['robot']['flags'], 16)

    def robot_send(self, json_cmd):
        """send one command over ws_cmd and block on its reply"""
        try:
            response = json.loads(run_sync(js.aimCmd(json.dumps(json_cmd))))
        except Exception as error:
            if STOP_MARK in str(error):
                raise                      # 停止不是错误，必须继续往上抛
            # the official library prints and carries on rather than raising
            print('robot: error processing command, reason:', error)
            return None
        cmd_id = json_cmd['cmd_id']
        seq = self._seq()
        if cmd_id in MOVE_ACTIVE_CMDS:
            self._move_until = seq + 2
        if cmd_id in TURN_ACTIVE_CMDS:
            self._turn_until = seq + 2
        if cmd_id in MOVING_CMDS:
            self._moving_until = seq + 2
            self._stopped_until = -1
        if cmd_id == 'imu_calibrate':
            self._imu_cal_until = seq + 2
        return response

    def _block_on_state(self, state_method, name='wait'):
        """poll until the state clears; give up after 10s and stop, as official does"""
        time_start = time.time()
        while True:
            if state_method() is False:
                run_sync(js.aimSleep(0.05))          # debounce, twice like official
                if state_method() is False:
                    return
            if time.time() - time_start > 10:
                print(name, 'wait timed out, stopping')
                self.stop_all_movement()
                return
            run_sync(js.aimSleep(0.1))

    # ── sensing motion ───────────────────────────────────────────────────────
    def get_x_position(self):
        """returns the x position of the robot"""
        origin_x = float(self.status['robot']['robot_x'])
        origin_y = float(self.status['robot']['robot_y'])
        offset_radians = -math.radians(self.inertial.heading_offset)
        return origin_x * math.cos(offset_radians) + origin_y * math.sin(offset_radians)

    def get_y_position(self):
        """returns the y position of the robot"""
        origin_x = float(self.status['robot']['robot_x'])
        origin_y = float(self.status['robot']['robot_y'])
        offset_radians = -math.radians(self.inertial.heading_offset)
        return origin_y * math.cos(offset_radians) - origin_x * math.sin(offset_radians)

    def is_move_active(self):
        """true while a move_at() or move_for() is running at nonzero speed"""
        if self._seq() < self._move_until:
            return True
        return bool(self._flags() & SYS_FLAGS_IS_MOVE_ACTIVE)

    def is_turn_active(self):
        """true while a turn(), turn_to() or turn_for() is running at nonzero speed"""
        if self._seq() < self._turn_until:
            return True
        return bool(self._flags() & SYS_FLAGS_IS_TURN_ACTIVE)

    def is_stopped(self):
        """true when no wheel should be moving at all"""
        if self._seq() < self._stopped_until:
            return True
        if self._seq() < self._moving_until:
            return False
        return not bool(self._flags() & SYS_FLAGS_IS_MOVING)

    def get_battery_capacity(self):
        """remaining battery charge, in percent"""
        return self.status['robot']['battery']

    # ── motion ───────────────────────────────────────────────────────────────
    def set_move_velocity(self, velocity, units=PERCENT):
        """override the default velocity for every later move. Default 50% (100 mm/s)"""
        if velocity < 0:
            raise ValueError('velocity must be a positive number')
        self.drive_speed = _drive_velocity(velocity, units)

    def set_turn_velocity(self, velocity, units=PERCENT):
        """override the default velocity for every later turn. Default 50% (75 deg/s)"""
        if velocity < 0:
            raise ValueError('velocity must be a positive number')
        self.turn_speed = _turn_velocity(velocity, units)

    def move_at(self, angle, velocity=None, units=PERCENT):
        """move forever at angle (-360 to 360), relative to where the robot is now.
        It keeps going until another action — a different angle, a turn, or a stop."""
        speed = self.drive_speed if velocity is None else _drive_velocity(velocity, units)
        self.robot_send({'cmd_id': 'drive', 'angle': angle, 'speed': speed,
                         'stacking_type': 0})

    def move_for(self, distance, angle, velocity=None, units=PERCENT, wait=True):
        """move distance (mm) at angle (-360 to 360). Waits for the move by default."""
        speed = self.drive_speed if velocity is None else _drive_velocity(velocity, units)
        if speed < 0:
            speed = -speed
            distance = -distance
        self.robot_send({'cmd_id': 'drive_for', 'distance': distance, 'angle': angle,
                         'final_heading': 0, 'drive_speed': speed,
                         'turn_speed': self.turn_speed, 'stacking_type': 0})
        if wait:
            self._block_on_state(self.is_move_active, 'is_move_active')

    def move_with_vectors(self, forwards, rightwards, rotation):
        """drive and spin at once, each argument a percent from -100 to 100"""
        x = max(-100, min(100, rightwards)) * 2.0
        y = max(-100, min(100, forwards)) * 2.0
        r = max(-100, min(100, rotation)) * 1.8
        w1 = (0.5 * x) + (0.866 * y) + r
        w2 = (0.5 * x) - (0.866 * y) + r
        w3 = r - x
        self.spin_wheels(int(w1), int(w2), int(w3))

    def turn(self, direction, velocity=None, units=PERCENT):
        """turn forever in direction (LEFT or RIGHT) until another action"""
        speed = self.turn_speed if velocity is None else _turn_velocity(velocity, units)
        if direction == TurnType.LEFT:
            speed = -speed
        self.robot_send({'cmd_id': 'turn', 'turn_rate': speed, 'stacking_type': 0})

    def turn_for(self, direction, angle, velocity=None, units=PERCENT, wait=True):
        """turn angle degrees in direction (LEFT or RIGHT). Waits by default."""
        speed = self.turn_speed if velocity is None else _turn_velocity(velocity, units)
        if direction == TurnType.LEFT:
            angle = -angle
        self.robot_send({'cmd_id': 'turn_for', 'angle': angle, 'turn_rate': speed,
                         'stacking_type': 0})
        if wait:
            self._block_on_state(self.is_turn_active, 'is_turn_active')

    def turn_to(self, heading, velocity=None, units=PERCENT, wait=True):
        """turn to an absolute heading (-360 to 360). Waits by default."""
        if not -360 < heading < 360:
            raise ValueError('heading must be between -360 and 360')
        speed = self.turn_speed if velocity is None else _turn_velocity(velocity, units)
        if speed < 0:
            speed = -speed
        heading = math.fmod(self.inertial.heading_offset + heading, 360)
        self.robot_send({'cmd_id': 'turn_to', 'heading': heading, 'turn_rate': speed,
                         'stacking_type': 0})
        if wait:
            self._block_on_state(self.is_turn_active, 'is_turn_active')

    def stop_all_movement(self):
        """stop every movement of the robot"""
        self.move_at(0, 0)
        self.turn(TurnType.RIGHT, 0)
        seq = self._seq()
        self._stopped_until = seq + 2
        self._moving_until = -1

    def spin_wheels(self, velocity1, velocity2, velocity3):
        """spin the three wheels at the given velocities"""
        self.robot_send({'cmd_id': 'spin_wheels', 'vel1': velocity1,
                         'vel2': velocity2, 'vel3': velocity3})

    def set_xy_position(self, x, y):
        """set the robot's current position to these coordinates"""
        offset_radians = -math.radians(self.inertial.heading_offset)
        self.robot_send({'cmd_id': 'set_pose',
                         'x': x * math.cos(offset_radians) - y * math.sin(offset_radians),
                         'y': y * math.cos(offset_radians) + x * math.sin(offset_radians)})
        target = self._seq() + 2      # wait out two packets, as official does
        while self._seq() < target:
            run_sync(js.aimSleep(0.05))

    # ── cargo ────────────────────────────────────────────────────────────────
    def _held(self, classnames, min_cx, max_cx, min_y):
        for obj in self.vision.get_data(VisionObject.ALL_AIOBJS):
            cx = obj.originX + obj.width / 2
            if obj.classname in classnames and min_cx < cx < max_cx and obj.originY > min_y:
                return True
        return False

    def has_any_barrel(self):
        """true if the kicker is holding a barrel of either colour"""
        return self._held(('BlueBarrel', 'OrangeBarrel'),
                          BARREL_MIN_CX, BARREL_MAX_CX, BARREL_MIN_Y)

    def has_blue_barrel(self):
        """true if the kicker is holding a blue barrel"""
        return self._held(('BlueBarrel',), BARREL_MIN_CX, BARREL_MAX_CX, BARREL_MIN_Y)

    def has_orange_barrel(self):
        """true if the kicker is holding an orange barrel"""
        return self._held(('OrangeBarrel',), BARREL_MIN_CX, BARREL_MAX_CX, BARREL_MIN_Y)

    def has_sports_ball(self):
        """true if the kicker is holding a ball"""
        return self._held(('SportsBall',), BALL_MIN_CX, BALL_MAX_CX, BALL_MIN_Y)


class Inertial:
    """the robot's inertial sensor. heading and rotation offsets live here, not on the robot."""

    def __init__(self, robot_instance):
        self.robot_instance = robot_instance
        self.heading_offset = 0
        self.rotation_offset = 0

    def calibrate(self):
        """calibrate the IMU"""
        self.robot_instance.robot_send({'cmd_id': 'imu_calibrate'})

    def set_heading(self, heading):
        """set the robot's heading to a given value"""
        self.heading_offset = self.get_heading_raw() - heading

    def reset_heading(self):
        """set the robot's heading to 0"""
        self.set_heading(0)

    def set_rotation(self, rotation):
        """set the robot's total rotation to a given value"""
        self.rotation_offset = self.get_rotation_raw() - rotation

    def reset_rotation(self):
        """set the robot's total rotation to 0"""
        self.set_rotation(0)

    def set_crash_sensitivity(self, sensitivity=SensitivityType.LOW):
        """set how hard a knock counts as a crash"""
        self.robot_instance.robot_send({'cmd_id': 'imu_set_crash_threshold',
                                        'sensitivity': sensitivity.value})

    def get_heading(self):
        """the robot's heading, 0 to 359.99 degrees"""
        heading = round(math.fmod(self.get_heading_raw() - self.heading_offset, 360), 2)
        return heading + 360 if heading < 0 else heading

    def get_heading_raw(self):
        """the IMU's heading, before any offset"""
        return float(self.robot_instance.status['robot']['heading'])

    def get_rotation(self):
        """total rotation in degrees since the last reset. Keeps counting past 360."""
        return round(self.get_rotation_raw() - self.rotation_offset, 2)

    def get_rotation_raw(self):
        """the IMU's rotation, before any offset"""
        return float(self.robot_instance.status['robot']['rotation'])

    def get_acceleration(self, axis):
        """acceleration along one axis, in g"""
        robot = self.robot_instance.status['robot']
        key = {AxisType.X_AXIS: 'x', AccelerationType.FORWARD: 'x',
               AxisType.Y_AXIS: 'y', AccelerationType.RIGHTWARD: 'y',
               AxisType.Z_AXIS: 'z', AccelerationType.DOWNWARD: 'z'}[axis]
        return float(robot['acceleration'][key])

    def get_turn_rate(self, axis):
        """gyro rate about one axis, -1000.00 to 1000.00 deg/s"""
        robot = self.robot_instance.status['robot']
        key = {AxisType.X_AXIS: 'x', OrientationType.ROLL: 'x',
               AxisType.Y_AXIS: 'y', OrientationType.PITCH: 'y',
               AxisType.Z_AXIS: 'z', OrientationType.YAW: 'z'}[axis]
        return float(robot['gyro_rate'][key])

    def get_roll(self):
        """roll angle, -180.00 to 180.00 degrees"""
        return round(float(self.robot_instance.status['robot']['roll']), 2)

    def get_pitch(self):
        """pitch angle, -90.00 to 90.00 degrees"""
        return round(float(self.robot_instance.status['robot']['pitch']), 2)

    def get_yaw(self):
        """yaw angle, -180.00 to 180.00 degrees"""
        return round(float(self.robot_instance.status['robot']['yaw']), 2)

    def is_calibrating(self):
        """true while the gyro is calibrating"""
        if self.robot_instance._seq() < self.robot_instance._imu_cal_until:
            return True
        return bool(self.robot_instance._flags() & SYS_FLAGS_IMU_CAL)


class Screen:
    """the robot's own 240x240 screen. Only a circle of r=120 is visible."""

    def __init__(self, robot_instance):
        self.robot_instance = robot_instance

    def print(self, *args, **kwargs):
        """print at the current cursor position and font"""
        sep = kwargs.get('sep', ' ')
        self.robot_instance.robot_send(
            {'cmd_id': 'lcd_print', 'string': sep.join(str(a) for a in args)})

    def print_at(self, *args, x=0, y=0, opaque=True, **kwargs):
        """print with the baseline start at (x, y)"""
        sep = kwargs.get('sep', ' ')
        self.robot_instance.robot_send(
            {'cmd_id': 'lcd_print_at', 'string': sep.join(str(a) for a in args),
             'x': x, 'y': y, 'b_opaque': opaque})

    def set_cursor(self, row, column):
        """move the text cursor"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_cursor', 'row': row, 'col': column})

    def next_row(self):
        """move the cursor to column 1 of the next row"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_next_row'})

    def clear_row(self, row, color=Color.BLUE):
        """clear one text row to a colour"""
        r, g, b = _rgb(color)
        self.robot_instance.robot_send({'cmd_id': 'lcd_clear_row', 'row': row,
                                        'r': r, 'g': g, 'b': b})

    def get_row(self):
        """the cursor's current row"""
        return int(self.robot_instance.status['robot']['screen']['row'])

    def get_column(self):
        """the cursor's current column"""
        return int(self.robot_instance.status['robot']['screen']['column'])

    def set_origin(self, x, y):
        """move the drawing origin"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_origin', 'x': x, 'y': y})

    def clear_screen(self, color=Color.BLUE):
        """fill the whole screen with a colour"""
        r, g, b = _rgb(color)
        self.robot_instance.robot_send({'cmd_id': 'lcd_clear_screen', 'r': r, 'g': g, 'b': b})

    def set_font(self, fontname):
        """choose the text font"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_font', 'fontname': fontname})

    def set_pen_width(self, width):
        """set the outline width for later drawing"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_pen_width', 'width': width})

    def set_pen_color(self, color=None, r=None, g=None, b=None):
        """set the outline colour, either a Color or r/g/b"""
        if color is not None:
            r, g, b = _rgb(color)
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_pen_color',
                                        'r': r or 0, 'g': g or 0, 'b': b or 0})

    def set_fill_color(self, color):
        """set the fill colour for later drawing"""
        r, g, b = _rgb(color)
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_fill_color', 'r': r, 'g': g,
                                        'b': b, 'transparent': _transparent(color)})

    def draw_pixel(self, x, y):
        """draw one pixel in the current pen colour"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_draw_pixel', 'x': x, 'y': y})

    def draw_line(self, x1, y1, x2, y2):
        """draw a line in the current pen colour"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_draw_line', 'x1': x1, 'y1': y1,
                                        'x2': x2, 'y2': y2})

    def draw_rectangle(self, x, y, width, height, color=None):
        """draw a rectangle. Outline uses the pen colour, fill uses color."""
        r, g, b = _rgb(color) if color is not None else (0, 0, 0)
        self.robot_instance.robot_send({'cmd_id': 'lcd_draw_rectangle', 'x': x, 'y': y,
                                        'width': width, 'height': height,
                                        'r': r, 'g': g, 'b': b,
                                        'transparent': _transparent(color)})

    def draw_circle(self, x, y, radius, color=None):
        """draw a circle. Outline uses the pen colour, fill uses color."""
        r, g, b = _rgb(color) if color is not None else (0, 0, 0)
        self.robot_instance.robot_send({'cmd_id': 'lcd_draw_circle', 'x': x, 'y': y,
                                        'radius': radius, 'r': r, 'g': g, 'b': b,
                                        'transparent': _transparent(color)})

    def set_clip_region(self, x, y, width, height):
        """restrict later drawing to this rectangle"""
        self.robot_instance.robot_send({'cmd_id': 'lcd_set_clip_region', 'x': x, 'y': y,
                                        'width': width, 'height': height})

    def show_emoji(self, emoji, look=EmojiLookType.LOOK_FORWARD):
        """show one of the 36 built-in emojis. It covers anything drawn underneath."""
        self.robot_instance.robot_send({'cmd_id': 'show_emoji', 'name': emoji.value,
                                        'look': look.value})

    def hide_emoji(self):
        """hide the emoji so the drawing underneath shows again"""
        self.robot_instance.robot_send({'cmd_id': 'hide_emoji'})

    def show_aivision(self):
        """let the robot draw its own AI vision overlay on its screen"""
        self.robot_instance.robot_send({'cmd_id': 'show_aivision'})

    def hide_aivision(self):
        """stop the AI vision overlay on the robot's screen"""
        self.robot_instance.robot_send({'cmd_id': 'hide_aivision'})

    def pressing(self):
        """true while the robot's screen is being touched"""
        return int(self.robot_instance.status['robot']['touch_flags'], 16) != 0

    def x_position(self):
        """x of the last screen touch"""
        return int(self.robot_instance.status['robot']['touch_x'])

    def y_position(self):
        """y of the last screen touch"""
        return int(self.robot_instance.status['robot']['touch_y'])


class Kicker:
    def __init__(self, robot_instance):
        self.robot_instance = robot_instance

    def kick(self, kick_type):
        """kick with SOFT, MEDIUM or HARD force"""
        self.robot_instance.robot_send({'cmd_id': str(kick_type.value)})

    def place(self):
        """put an object down gently in front of the robot"""
        self.kick(KickType.SOFT)


class Sound:
    def __init__(self, robot_instance):
        self.robot_instance = robot_instance

    def play(self, sound, volume=50):
        """play a built-in sound and carry straight on without waiting"""
        self.robot_instance.robot_send({'cmd_id': 'play_sound',
                                        'name': str(sound.value).lower(),
                                        'volume': volume})

    def play_file(self, name, volume=50):
        """play a sound the user loaded with the VEXcode AIM app"""
        self.robot_instance.robot_send({'cmd_id': 'play_file', 'name': name,
                                        'volume': volume})

    def play_note(self, note, octave=0, duration=750, volume=50):
        """play one note. note is a MIDI number here, not a name."""
        self.robot_instance.robot_send({'cmd_id': 'play_note', 'note': note,
                                        'octave': octave, 'duration': duration,
                                        'volume': volume})

    def is_active(self):
        """true while a sound is playing or still being sent"""
        flags = self.robot_instance._flags()
        return bool(flags & SYS_FLAGS_SOUND_PLAYING) or bool(flags & SYS_FLAGS_IS_SOUND_DNL)

    def stop(self):
        """stop the sound that is playing. It takes a moment to actually stop."""
        self.robot_instance.robot_send({'cmd_id': 'stop_sound'})


class Led:
    def __init__(self, robot_instance):
        self.robot_instance = robot_instance

    def on(self, *args):
        """led.on(ALL_LEDS, BLUE) or led.on(1, BLUE) or led.on(LED1, r, g, b).
        An int index is 0-based, so on(1, ...) lights light2 — as in the official library."""
        if len(args) not in (2, 4):
            raise TypeError('must have two or four arguments')
        if isinstance(args[0], int):
            light = 'light' + str(args[0] + 1) if args[0] in range(0, 6) else 'all'
        elif isinstance(args[0], LightType):
            light = args[0].value
        else:
            raise TypeError('first argument must be of type int or LightType')
        if len(args) == 2:
            r, g, b = _rgb(args[1])
        else:
            r, g, b = args[1], args[2], args[3]
        self.robot_instance.robot_send({'cmd_id': 'light_set',
                                        light: {'r': r, 'g': g, 'b': b}})

    def off(self, led=LightType.ALL_LEDS):
        """turn one LED, or all of them, off"""
        light = led.value if isinstance(led, LightType) else (
            'light' + str(led + 1) if isinstance(led, int) and led in range(0, 6) else 'all')
        self.robot_instance.robot_send({'cmd_id': 'light_set',
                                        light: {'r': 0, 'g': 0, 'b': 0}})


class AiVisionObject:
    """one detection, with the official attribute names"""

    def __init__(self, index, obj, classnames):
        type_bits = int(obj['type'])
        self.index = index
        self.id = int(obj['id'])
        self.originX = int(obj['originx'])
        self.originY = int(obj['originy'])
        self.width = int(obj['width'])
        self.height = int(obj['height'])
        self.centerX = self.originX + self.width / 2
        self.centerY = self.originY + self.height / 2
        self.exists = True
        if type_bits & 8:
            self.type = 'tag'
            self.classname = 'Tag' + str(self.id)
            self.angle = float(obj.get('angle', 0))
        else:
            self.type = 'aiobj' if type_bits & 4 else ('code' if type_bits & 2 else 'color')
            self.classname = classnames.get(self.id, obj.get('name', 'AI' + str(self.id)))
            # colour and code angles arrive in centi-degrees
            self.angle = float(obj.get('angle', 0)) * (1 if type_bits & 4 else 0.01)
        self.score = None if obj.get('score') is None else float(obj['score'])
        # same polynomial the official client uses to turn frame pixels into a bearing
        cx, cy = self.centerX, self.centerY
        self.bearing = (-34.656 + cx * 0.22539 + cy * 0.011526
                        + cx * cx * -0.000042011 + cx * cy * 0.000010433
                        + cy * cy * -0.00007073)

    def __repr__(self):
        return ('AiVisionObject(' + self.classname + ' at ' + str(int(self.centerX))
                + ',' + str(int(self.centerY)) + ')')


class AiVision:
    ALL_VISION = VisionObject.ALL_VISION
    ALL_TAGS = VisionObject.ALL_TAGS
    ALL_AIOBJS = VisionObject.ALL_AIOBJS
    ALL_CARGO = VisionObject.ALL_CARGO

    def __init__(self, robot_instance):
        self.robot_instance = robot_instance

    def get_data(self, type=VisionObject.ALL_VISION, count=8):
        """the objects the robot currently sees, newest packet only.
        The rail's 「视觉」 checkboxes gate what the robot even detects — anything
        unticked there is switched off at the source and will never appear here."""
        packet = self.robot_instance.status.get('aivision') or {}
        classnames = {}
        for item in (packet.get('classnames') or {}).get('items', []):
            classnames[int(item['index'])] = item['name']
        items = (packet.get('objects') or {}).get('items', [])
        n = min(int((packet.get('objects') or {}).get('count', 0)), len(items), count)
        objects = [AiVisionObject(i, items[i], classnames) for i in range(n)]
        return [o for o in objects if self._matches(o, type)]

    def _matches(self, obj, want):
        if want == VisionObject.ALL_VISION:
            return True
        if want == VisionObject.ALL_TAGS:
            return obj.type == 'tag'
        if want == VisionObject.ALL_AIOBJS:
            return obj.type == 'aiobj'
        if want == VisionObject.ALL_COLORS:
            return obj.type == 'color'
        if want == VisionObject.ALL_CODES:
            return obj.type == 'code'
        if want == VisionObject.ALL_CARGO:
            return obj.classname in ('BlueBarrel', 'OrangeBarrel', 'SportsBall')
        if want in AI_CLASSNAME:
            return obj.classname == AI_CLASSNAME[want]
        if want.name.startswith('TAG'):
            return obj.type == 'tag' and obj.id == int(want.name[3:])
        return False

    def object_count(self, type=VisionObject.ALL_VISION):
        """how many objects of a kind the robot sees right now"""
        return len(self.get_data(type, 64))

    def largest_object(self, type=VisionObject.ALL_VISION):
        """the biggest object of a kind, or None"""
        objects = self.get_data(type, 64)
        if not objects:
            return None
        return max(objects, key=lambda o: o.width * o.height)

    def tag_detection(self, enable):
        """switch AprilTag detection on the robot on or off"""
        self.robot_instance.robot_send({'cmd_id': 'tag_detection', 'b_enable': bool(enable)})

    def color_detection(self, enable, merge=False):
        """switch colour detection on the robot on or off"""
        self.robot_instance.robot_send({'cmd_id': 'color_detection',
                                        'b_enable': bool(enable), 'b_merge': bool(merge)})

    def model_detection(self, enable):
        """switch the trained-object model on the robot on or off"""
        self.robot_instance.robot_send({'cmd_id': 'model_detection', 'b_enable': bool(enable)})


class Timer:
    """a stopwatch, in the shape of the official one"""

    def __init__(self):
        self._start = time.time()

    def time(self, units=TimeUnits.MSEC):
        """elapsed time since the last reset"""
        seconds = time.time() - self._start
        return seconds if units == TimeUnits.SECONDS else int(seconds * 1000)

    def reset(self):
        """restart from zero"""
        self._start = time.time()


def wait(amount, units=TimeUnits.SECONDS):
    """pause the program. Interruptible — 停止 breaks out of it."""
    run_sync(js.aimSleep(amount if units == TimeUnits.SECONDS else amount / 1000.0))


sleep = wait

# The page owns the connection, so a robot already exists by the time a program runs.
# An official example opens with "from vex import *" and its own "robot = Robot()";
# both still work — Robot() only binds to the page's sockets, so another one is free,
# and these shim modules let the import lines run instead of raising ModuleNotFoundError.
robot = Robot()

import sys, types
_vex = types.ModuleType('vex')
_vex.__dict__.update({k: v for k, v in globals().items() if not k.startswith('_')})
_vex_globals = types.ModuleType('vex.vex_globals')
_vex_globals.__dict__.update(_vex.__dict__)
_vex.vex_globals = _vex_globals
sys.modules['vex'] = _vex
sys.modules['vex.vex_globals'] = _vex_globals
`;
