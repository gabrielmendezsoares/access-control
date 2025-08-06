import osu from 'node-os-utils';
import { IResponse, IResponseData } from './interfaces/index.js';

export const getHealth = async (): Promise<IResponse.IResponse<IResponseData.IGetHealthResponseData>> => {
  return {
    status: 200,
    data: {
      monitor: {
        cpuUsage: {
          name: 'Uso de CPU',
          value: `${ (await osu.cpu.usage()).toFixed(1) }%`
        },
        memoryUsage: {
          name: 'Uso de memória',
          value: `${ (await osu.mem.used()).usedMemMb.toFixed(1) }MB`
        }
      }
    }
  };
};
