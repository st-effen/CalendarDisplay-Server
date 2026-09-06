/* Date and Time functions */
var dayjs = require('dayjs');
var localizedFormat = require('dayjs/plugin/localizedFormat');
var isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
var isBetween = require('dayjs/plugin/isBetween');
var timezone = require('dayjs/plugin/timezone');
var utc = require('dayjs/plugin/utc');
dayjs.extend(localizedFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isBetween);

const DEFAULT_FALLBACK_ZONE = process.env.CALENDAR_TIMEZONE || 'UTC';

function parseDateWithZone(val, fallbackZone) {
  const zone = (val && val.tz) || fallbackZone || DEFAULT_FALLBACK_ZONE;
  try {
    if (zone) {
      // If val is a Date or an ISO string, tz() will interpret it in the given zone
      return dayjs.tz(val, zone);
    } else {
      // Fallback to normal parsing (keeps offsets if present)
      return dayjs(val);
    }
  } catch (e) {
    return dayjs(val);
  }
}

const icalToJSON = function (data) {
  var rangeStart = dayjs().startOf('day').toDate();
  var rangeEnd = dayjs().endOf('day').add(2, 'week').toDate();
  var formatted = [];

  var i = j = 0;
  for (let k in data) {
    if (data.hasOwnProperty(k)) {
      var ev = data[k];
      if (ev.type == 'VEVENT') {

        // determine event zone (use start.tz if present, else fallback)
        const eventZone = (ev.start && ev.start.tz) || DEFAULT_FALLBACK_ZONE;

        // Event Object
        var event = {
          type: 'VEVENT',
          uid: ev.uid,
          start: ev.start ? parseDateWithZone(ev.start, eventZone).unix() : null,
          end: ev.end ? parseDateWithZone(ev.end, eventZone).unix() : null,
          allday: false,
          tzid: (ev.start && ev.start.tz) ? ev.start.tz : (process.env.CALENDAR_TIMEZONE || null),
          categories: (ev.categories !== undefined) ? ev.categories.join(",") : null || null
        };

        if (ev.summary && typeof (ev.summary) == 'object')
          event.summary = ev.summary.val.replace(/\n/g, ' ');
        else if (ev.summary)
          event.summary = ev.summary.replace(/\n/g, ' ');
        else
          event.summary = null;

        if (ev.location && typeof (ev.location) == 'object')
          event.location = ev.location.val.replace(/\n/g, ' ');
        else if (ev.location)
          event.location = ev.location.replace(/\n/g, ' ');
        else
          event.location = null;

        if (ev.start && !ev.end || ev.start && ev.end && dayjs(ev.end).diff(ev.start, 'hour') >= 24)
          event.allday = true;

        // set gmtoffset for the event (based on parsed start)
        if (ev.start) {
          event.gmtoffset = parseDateWithZone(ev.start, eventZone).utcOffset();
        }

        // Check if there is an event with an alarm
        var keys = Object.keys(ev);
        for (var a in keys) {
          if (typeof ev[keys[a]] === 'object' && ev[keys[a]].type !== undefined && ev[keys[a]].type == 'VALARM') {
            event.alarm = ev[keys[a]];
          }
        }

        // Events in the next two weeks without rrule
        if (!ev.rrule && dayjs().isSameOrBefore(ev.start, 'date') && dayjs().add(2, 'week').isAfter(ev.start, 'date')) {
          formatted.push({ ...event });
        }
        else if (ev.rrule) {
          // For recurring events, get the set of event start dates that fall within the range
          var dates = ev.rrule.between(
            rangeStart,
            rangeEnd,
            true,
            function (date, i) {
              return true;
            }
          );

          // Add recurrence overrides if any
          if (ev.recurrences !== undefined) {
            for (var r in ev.recurrences) {
              if (dayjs(new Date(r)).isBetween(rangeStart, rangeEnd) != true) {
                dates.push(new Date(r));
              }
            }
          }

          // Loop through recurrence dates
          for (i in dates) {
            var date = dates[i];
            var curEvent = ev;
            var showRecurrence = true;

            // Calculate the events duration (in seconds)
            var curDuration = parseInt(dayjs(curEvent.end).unix()) - parseInt(dayjs(curEvent.start).unix());

            // startDate is the recurrence date (day/month/year), we'll combine with the time of the original event in the same zone
            var startDate = dayjs(date);

            // Lookup key for recurrences/exceptions
            var dateLookupKey = date.toISOString().substring(0, 10);

            if ((curEvent.recurrences !== undefined) && (curEvent.recurrences[dateLookupKey] !== undefined)) {
              curEvent = curEvent.recurrences[dateLookupKey];
            } else if ((curEvent.exdate !== undefined) && (curEvent.exdate[dateLookupKey] !== undefined)) {
              showRecurrence = false;
            }

            // Build startDate/time in the correct zone instead of string concatenation
            const zone = (curEvent.start && curEvent.start.tz) || DEFAULT_FALLBACK_ZONE;
            const timeOfDay = curEvent.start ? parseDateWithZone(curEvent.start, zone) : null;

            if (!timeOfDay) {
              // if we don't have a base start time, skip
              continue;
            }

            // Build a new start using the recurrence date and the original event's time in the same zone
            var newStart = dayjs.tz(date, zone)
              .hour(timeOfDay.hour())
              .minute(timeOfDay.minute())
              .second(timeOfDay.second());

            var newEnd = newStart.add(curDuration, 'second');

            // If this recurrence ends before the start of the date range, or starts after the end of the date range, skip
            if (newEnd.isBefore(rangeStart) || newStart.isAfter(rangeEnd)) {
              showRecurrence = false;
            }

            if (showRecurrence === true) {
              event.start = newStart.unix();
              event.end = newEnd.unix();
              event.gmtoffset = newStart.utcOffset();
              event.tzid = zone || event.tzid;

              find = formatted.findIndex(function (e) {
                return (e.uid == event.uid && e.start == event.start);
              });

              if (find == -1) {
                formatted.push({ ...event });
              }
            }
          }
        }
        else {
          continue;
        }
      }
    }
  }

  // sort by unix timestamp (numeric)
  formatted = formatted.sort(function (a, b) {
    return (a.start || 0) - (b.start || 0);
  });

  return formatted;
};

module.exports = icalToJSON;
