import * as moment from 'moment'
import { Moment } from 'moment'

type VolumeCache = {
  [key: number]: Volume
}

type Volume = {
  [indent: string]: string
}

const DAY = 1000 * 60 * 60 * 24;
export const MAX_PERIOD = 120 * DAY // 60 days

const CACHE_MAX_SIZE = 60 // days
const GC_INTERVAL = DAY / 2 // 12 hours

export class VolumesCache {
  private volumes: VolumeCache = {}

  constructor(private network: number) {}

  getDayVolume (day: number): Volume {
    return this.volumes[day];
  }

  setDayVolume (day: number, volume: Volume) {
    this.volumes[day] = volume
  }

  startGC () {
    const oldest = moment().subtract(CACHE_MAX_SIZE, 'day').utc().startOf('day')
    setInterval(
      () => {
        this.volumes = Object
          .entries(this.volumes)
          .reduce<VolumeCache>(
            (acc, [date, volume]) => {
              if (moment(+date).isSameOrAfter(oldest)) {
                acc[+date] = volume;
              }
              return acc;
            },
            {}
          )
      },
      +GC_INTERVAL
    )
  }
}

type Period = [number, number]

export const generatePeriods = (start: Moment, end: Moment): Array<Period> => {
  if (start.isAfter(end)) throw new Error('Invalid start time!')

  const endPeriod: Period = [moment(end).utc().startOf('day').valueOf(), end.valueOf()]

  let days: Array<Period> = []
  let curr = start
  while (curr.isBefore(endPeriod[0])) {
    days.push([
      curr.utc().startOf('day').valueOf(),
      curr.utc().endOf('day').valueOf()
    ])
    curr = curr.add(1, 'day')
  }

  return [...days, endPeriod]
}
