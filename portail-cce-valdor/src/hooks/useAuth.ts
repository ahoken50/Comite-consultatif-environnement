import { useSelector } from 'react-redux';
import { RootState } from '../../store/rootReducer';

export const useAuth = () => {
    const auth = useSelector((state: RootState) => state.auth);
    return auth;
};
