#!/bin/sh
# dsh-omni: keep the host from idle-sleeping while it is on AC power.
#
# `caffeinate -s` creates a PreventSystemSleep assertion. Per caffeinate(8), the
# `-s` assertion is only honored on AC power, so unplugging still lets the Mac
# sleep (which matches the battery-saving policy).
#
# It does NOT keep the display on: the screen can still turn off, the system
# stays awake. Closing the lid still sleeps the Mac.
exec /usr/bin/caffeinate -s
