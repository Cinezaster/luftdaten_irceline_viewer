import * as generic_functions from './generic_functions'
import store from '../redux/store'
import { addStations, setReachable, setUpdating } from '../redux/stationUpdates/actions'
import { setTime } from '../redux/appState/actions'

const radius = 150
const stationsBoth = {
  luftdaten: [],
  irceline: []
}

export const updateLuftdaten = async () => {
  stationsBoth.luftdaten = []

  if (store.getState().appState.dataOrigin.luftdaten === false)
    return

  store.dispatch(setReachable(true, 'luftdaten'))
  store.dispatch(setTime(null))
  store.dispatch(setUpdating(true, 'luftdaten'))

  let luftdaten_all_url = 'https://api.luftdaten.info/v1/filter/area=50.8531,4.3550,' + radius
  let luftdaten_all_json = await generic_functions.fetch_json(luftdaten_all_url, 'luftdaten')
  let luftdaten_stations = parse_luftdaten_data(luftdaten_all_json)

  const time = new Date().toLocaleTimeString()
  store.dispatch(setTime(time))
  store.dispatch(setUpdating(false, 'luftdaten'))

  stationsBoth.luftdaten = luftdaten_stations
  combineData()

}

export const updateIrceline = async () => {
  stationsBoth.irceline = []

  if (store.getState().appState.dataOrigin.luftdaten === false)
    return

  store.dispatch(setReachable(true, 'irceline'))
  store.dispatch(setTime(null))
  store.dispatch(setUpdating(true, 'irceline'))

  //TODO JSON.stringify
  // const t =    {
  //   center: {
  //     type: "Point",
  //     coordinates: [4.3550,50.8531]
  //   },
  //     radius
  //   }

  /// Irceline fetch
  let irceline_pm10_url = 'https://geo.irceline.be/sos/api/v1/stations?near=' +
    encodeURI(
      '{\
    "center": {\
      "type": "Point",\
      "coordinates": [4.3550,50.8531]\
    },\
      "radius": ' + radius + '\
    }\
    &phenomenon=5'.replace(/\s{2,}/, '')
    )
  let irceline_pm25_url = 'https://geo.irceline.be/sos/api/v1/stations?near=' +
    encodeURI(
      '{\
  "center": {\
    "type": "Point",\
    "coordinates": [4.3550,50.8531]\
  },\
    "radius": ' + radius + '\
  }\
  &phenomenon=6001'.replace(/\s{2,}/, '')
    )

  let irceline_temp_url = 'https://geo.irceline.be/sos/api/v1/stations?near=' +
    encodeURI(
      '{\
  "center": {\
    "type": "Point",\
    "coordinates": [4.3550,50.8531]\
  },\
    "radius": ' + radius + '\
  }\
  &phenomenon=62101'.replace(/\s{2,}/, '')
    )

  let irceline_pm10_json = await generic_functions.fetch_json(irceline_pm10_url, 'irceline')
  let irceline_pm25_json = await generic_functions.fetch_json(irceline_pm25_url, 'irceline')
  let irceline_temp_json = await generic_functions.fetch_json(irceline_temp_url, 'irceline')

  let irceline_pm10_promise = await parse_irceline_data(irceline_pm10_json)
  let irceline_pm25_promise = await parse_irceline_data(irceline_pm25_json)
  let irceline_temp_promise = await parse_irceline_data(irceline_temp_json)

  //TODO spread operator
  let irceline_stations = await irceline_pm10_promise.concat(irceline_pm25_promise, irceline_temp_promise)

  irceline_stations = irceline_stations.reduce(
    (accumulator, station) => {

      let duplicate = accumulator.find(
        (stationDuplicateCheck) => {
          return stationDuplicateCheck.id === station.id
        }
      )

      if (!duplicate) {
        accumulator.push(station)
      }

      return accumulator
    }, []
  )

  const time = new Date().toLocaleTimeString()
  store.dispatch(setTime(time))
  store.dispatch(setUpdating(false, 'irceline'))

  if (irceline_stations.length === 0)
    store.dispatch(setReachable(false, 'irceline'))
  stationsBoth.irceline = irceline_stations
  combineData()
}

export const combineData = () => {

  let stations = stationsBoth.luftdaten.concat(stationsBoth.irceline)
  store.dispatch(addStations(stations))

}

const parse_irceline_data = async (data) => {
  let data_array = data.map(
    async (station) => {

      let pm10_request_url = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=5&force_latest_values=true'
      let pm25_request_url = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=6001&force_latest_values=true'
      let temp_request_url = 'https://geo.irceline.be/sos/api/v1/timeseries?expanded=true&station=' + station.properties.id + '&phenomenon=62101&force_latest_values=true'

      let irceline_data = await (async () => {
        let pm10_request, pm25_request, temp_request
        try {
          pm10_request = await generic_functions.fetch_json(pm10_request_url) || []
          pm25_request = await generic_functions.fetch_json(pm25_request_url) || []
          temp_request = await generic_functions.fetch_json(temp_request_url) || []
        } catch (e) {
          console.log('invalid irceline data', e)
        }
        let pm10_response = pm10_request[0] || false
        let pm25_response = pm25_request[0] || false
        let temp_response = temp_request[0] || false
        return [pm10_response, pm25_response, temp_response]
      })().then(data => data)

      let pm10_response = irceline_data[0]
      let pm25_response = irceline_data[1]
      let temp_response = irceline_data[2]

      let sensorID = (pm10_response) ? pm10_response.id : (pm25_response) ? pm25_response.id : (temp_response) ? temp_response.id : null
      let sensorName = (pm10_response) ? pm10_response.parameters.procedure.label : (pm25_response) ? pm25_response.parameters.procedure.label : (temp_response) ? temp_response.parameters.procedure.label : null

      if (sensorID === null || sensorName === null)
        return false

      sensorName = sensorName.split(' - ')[1].split(';')[0]
      let PM10 = (pm10_response && pm10_response.lastValue.value >= 0) ? pm10_response.lastValue.value : null
      let PM25 = (pm25_response && pm25_response.lastValue.value >= 0) ? pm25_response.lastValue.value : null
      let temp = (temp_response && temp_response.lastValue.value >= 0) ? temp_response.lastValue.value : null

      /// Splitting sensor into PM or temperature sensor
      let PM_object = (pm10_response || pm25_response) ? {
        id: 'I-' + sensorID + 'p',
        manufacturer: null,
        name: sensorName,
        PM10: PM10,
        PM25: PM25,
        stationID: 'I-' + station.properties.id
      } : null

      let temp_object = (temp_response) ? {
        id: 'I-' + sensorID + 't',
        manufacturer: null,
        name: sensorName,
        temperature: temp,
        stationID: 'I-' + station.properties.id
      } : null

      let sensors = [
        PM_object,
        temp_object
      ].filter(
        (sensor) => {
          return sensor !== null
        }
      )

      return {
        id: 'I-' + station.properties.id,
        latitude: station.geometry.coordinates[1],
        longitude: station.geometry.coordinates[0],
        origin: 'irceline',
        sensors: sensors
      }

    }
  )

  //reduce data array to collection of valid data_sets, filter out invalid API returns
  data_array = await Promise.all(data_array)
  data_array = data_array.reduce(
    (valid_data, data_set) => data_set ? valid_data.concat(data_set) : valid_data,
    []
  )
  return data_array
}

const parse_luftdaten_data = (data) => {
  let parsed_data_array = []
  data.forEach(
    (station) => {
      if (parsed_data_array.find(
          (duplicateCheck) => {
            return duplicateCheck.id === station.location.id
          }
        )) {
        return
      }

      let parsed_station = {
        id: station.location.id,
        latitude: station.location.latitude,
        longitude: station.location.longitude,
        origin: 'luftdaten',
        sensors: []
      }

      let duplicates = data.filter(
        (duplicateCheck) => {
          return duplicateCheck.location.id === station.location.id
        }
      )
      duplicates.push(station)
      duplicates.sort(generic_functions.sort_raw_data_by_timestamp)

      for (let d in duplicates) {
        let currentStation = duplicates[d]
        for (let s in currentStation.sensordatavalues) {
          let currentSensorDataValue = currentStation.sensordatavalues[s]
          let currentSensor = parsed_station.sensors
            .find(
              (sensor) => {
                return sensor.id === 'L-' + currentStation.sensor.id
              }
            )
          if (currentSensor) {
            parsed_station.sensors = parsed_station.sensors.filter(
              (sensor) => {
                return sensor.id !== currentSensor.id
              }
            )
          } else {
            currentSensor = {
              id: 'L-' + currentStation.sensor.id,
              manufacturer: currentStation.sensor.sensor_type.manufacturer,
              name: currentStation.sensor.sensor_type.name,
              stationID: 'L-' + station.location.id
            }
          }

          switch (currentSensorDataValue.value_type) {
            case 'P1':
              currentSensor.PM10 = currentSensorDataValue.value
              break
            case 'P2':
              currentSensor.PM25 = currentSensorDataValue.value
              break
            case 'temperature':
              currentSensor.temperature = currentSensorDataValue.value
              break
            case 'humidity':
              currentSensor.humidity = currentSensorDataValue.value
              break
            default:
              break
          }
          parsed_station.sensors.push(currentSensor)
        }
      }

      parsed_data_array.push(parsed_station)

    }
  )

  return parsed_data_array
}
